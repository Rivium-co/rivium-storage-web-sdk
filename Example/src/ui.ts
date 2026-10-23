/** Small DOM helpers: every action shows its result or its exact error. Nothing is swallowed. */
import { RiviumStorageException, StorageErrorCode } from '@rivium/storage-web';
import { DemoServerError } from './demo-server';

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
}

/**
 * A refused image transform as an app should show it: a title per `code`, the
 * server's message, the code and what to do. The page fetches transform URLs
 * itself, so it reads `code` / `message` from the JSON body of the non-2xx
 * answer (never the raw body or the URL with the file id).
 */
export class TransformRefusal extends RiviumStorageException {
  readonly title: string;
  readonly hint: string | undefined;
  /** Seconds from the `Retry-After` header (`transform_busy` sends 2), when the answer had one. */
  retryAfter: number | undefined;

  constructor(status: number, body: { code?: unknown; message?: unknown }) {
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : typeof body.message === 'string' && body.message
        ? body.message
        : `The server answered HTTP ${status}.`;
    const code = typeof body.code === 'string' && body.code ? body.code : undefined;
    super(message, status, code);
    this.name = 'TransformRefusal';
    [this.title, this.hint] = transformTitle(code, status);
  }

  /** Reads the JSON body of a refused transform response. */
  static async from(res: Response): Promise<TransformRefusal> {
    const body = await res.json().catch(() => ({}));
    const refusal = new TransformRefusal(res.status, body && typeof body === 'object' ? body : {});
    const retryAfter = Number(res.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter >= 0) refusal.retryAfter = retryAfter;
    return refusal;
  }

  /** The lines under the title. */
  get details(): string {
    return [this.message, `code: ${this.code ?? '(none)'} · HTTP ${this.statusCode}`, this.hint ? `What to do: ${this.hint}` : null]
      .filter(Boolean)
      .join('\n');
  }
}

function transformTitle(code: string | undefined, status: number): [string, string | undefined] {
  const denied: [string, string] = ['Access denied', "The bucket's access rules refused this user."];
  switch (code) {
    case StorageErrorCode.ImageFormatNotSupported:
      return ['Format not supported', 'Convert it to JPEG, PNG or WebP and upload it again.'];
    case StorageErrorCode.NotAnImage:
      return ['Not an image', 'Pick an image file.'];
    case StorageErrorCode.ImageDamaged:
      return ['Image damaged', 'Upload it again.'];
    case StorageErrorCode.ImageTooLarge:
      return ['Image too large', 'Use a smaller image (up to 50 megapixels).'];
    case StorageErrorCode.InvalidTransform:
      return ['Invalid options', 'Change the transform options.'];
    case StorageErrorCode.SourceTooLarge:
      return ['File too large', 'Use an image under 25 MB.'];
    case StorageErrorCode.PlanFeatureLocked:
      return ['Not in your plan', "Image transforms aren't in this project's plan (Free). Upgrade the plan, or show the plain public link."];
    case StorageErrorCode.TooManyVariants:
      return ['Too many sizes', 'This image already has 50 sizes / formats. Use a few fixed sizes (for example 200, 600 and 1200 wide).'];
    case StorageErrorCode.TransformBusy:
      return ['Busy', 'Image processing is busy. Try again in a moment.'];
    case StorageErrorCode.TokenRequired:
    case StorageErrorCode.TokenInvalid:
    case StorageErrorCode.TokenExpired:
      return ['Sign-in needed', 'Sign in again, then retry.'];
    case StorageErrorCode.AccessDenied:
      return denied;
  }
  if (status === 403) return denied;
  if (status === 404) return ['File not found', 'Upload the image again.'];
  return ["Couldn't transform the image", undefined];
}

export function describeError(e: unknown): string {
  if (e instanceof TransformRefusal) return `${e.title}\n${e.details}`;
  if (e instanceof RiviumStorageException) {
    return `RiviumStorageException\nstatus:  ${e.statusCode ?? '-'}\ncode:    ${e.code ?? '-'}\nmessage: ${e.message}`;
  }
  if (e instanceof DemoServerError) {
    return `Example server error\nstatus:  ${e.status ?? '-'}\ncode:    ${e.code ?? '-'}\nmessage: ${e.message}`;
  }
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

export function format(value: unknown): string {
  if (value === undefined) return 'Done (no value returned).';
  if (typeof value === 'string') return value;
  return JSON.stringify(
    value,
    (_k, v) => (v instanceof ArrayBuffer ? `<ArrayBuffer ${v.byteLength} bytes>` : v instanceof Uint8Array ? `<Uint8Array ${v.length} bytes>` : v),
    2,
  );
}

export function show(out: HTMLElement, value: unknown, kind: 'ok' | 'error' | 'info' = 'ok'): void {
  out.textContent = format(value);
  out.dataset.kind = kind;
  out.hidden = false;
}

export function showError(out: HTMLElement, e: unknown): void {
  if (e instanceof TransformRefusal) {
    out.replaceChildren(el('strong', { textContent: e.title }), `\n${e.details}`);
  } else {
    out.textContent = describeError(e);
  }
  out.dataset.kind = 'error';
  out.hidden = false;
}

/**
 * Runs an action for a button: disables it while busy, shows the result (or the exact error) in `out`.
 * Returns the result, or undefined when it failed (the error is on screen).
 */
export async function action<T>(button: HTMLButtonElement | null, out: HTMLElement, fn: () => Promise<T>): Promise<T | undefined> {
  if (button) button.disabled = true;
  out.textContent = 'Working...';
  out.dataset.kind = 'info';
  out.hidden = false;
  busyOutputs.add(out);
  try {
    const result = await fn();
    show(out, result);
    return result;
  } catch (e) {
    showError(out, e);
    return undefined;
  } finally {
    busyOutputs.delete(out);
    if (button) button.disabled = false;
  }
}

/** The outputs of the actions still running, so a waiting call can say why it waits. */
const busyOutputs = new Set<HTMLElement>();

/**
 * While the SDK holds file calls for a user token (`isAwaitingUserToken`), every running action shows `reason`
 * instead of "Working..."; `null` puts "Working..." back. The calls are not failed: they go on after sign-in.
 */
export function showWaitingForToken(reason: string | null): void {
  for (const out of busyOutputs) {
    const text = reason ?? 'Working...';
    if (out.textContent !== text) out.textContent = text;
    out.dataset.kind = reason ? 'warn' : 'info';
  }
}

export function onClick(id: string, out: HTMLElement, fn: () => Promise<unknown>): void {
  const button = $<HTMLButtonElement>(id);
  button.addEventListener('click', () => void action(button, out, fn));
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}
