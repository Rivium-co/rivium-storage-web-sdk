import type { UploadProgress } from './models';

/** Minimum time between two progress events, unless the upload moved by 1% or more. */
const PROGRESS_INTERVAL_MS = 50;

/** Sends a request and resolves with its response, like `fetch`. */
export type Transport = (
  url: string,
  init: RequestInit & { headers: Record<string, string> },
) => Promise<Response>;

/** The default transport: the global `fetch`, looked up on every call. */
export const fetchTransport: Transport = (url, init) => fetch(url, init);

/**
 * Wraps `onProgress` so it is called at most every 50 ms or every 1% of the
 * upload, never with `bytesSent` above `totalBytes`, never twice with the same
 * value, and once with `bytesSent === totalBytes` at the end.
 */
export function createProgressReporter(
  onProgress: (progress: UploadProgress) => void,
  now: () => number = Date.now,
): (bytesSent: number, totalBytes: number, final?: boolean) => void {
  let lastAt = -Infinity;
  let lastSent = -1;
  let finished = false;

  return (bytesSent, totalBytes, final = false) => {
    if (finished || !(totalBytes > 0)) return;
    const sent = Math.min(Math.max(0, bytesSent), totalBytes);
    const isFinal = final || sent >= totalBytes;
    const value = isFinal ? totalBytes : sent;
    if (!isFinal) {
      if (value === lastSent) return;
      const t = now();
      const movedEnough = value - Math.max(lastSent, 0) >= totalBytes / 100;
      if (t - lastAt < PROGRESS_INTERVAL_MS && !movedEnough) return;
      lastAt = t;
    } else {
      finished = true;
    }
    lastSent = value;
    try {
      onProgress({ bytesSent: value, totalBytes });
    } catch (e) {
      // A throwing callback must not break the upload.
      console.error('[RiviumStorage] onProgress threw:', e);
    }
  };
}

/** Statuses whose response can't have a body (the Response constructor rejects one). */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    try {
      headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
    } catch {
      // skip a header the Headers class refuses
    }
  }
  return headers;
}

/**
 * XMLHttpRequest follows redirects and can't be told not to (fetch is sent with
 * `redirect: 'error'`). The API never redirects, so a response that came from
 * another origin than the one asked is refused instead of used.
 */
export function cameFromOtherOrigin(requested: string, responseURL: string | null | undefined): boolean {
  if (!responseURL) return false;
  try {
    return new URL(responseURL).origin !== new URL(requested).origin;
  } catch {
    return true;
  }
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * A transport on XMLHttpRequest, because `fetch` can't report upload
 * progress. It sends the same method, headers and body as `fetch` would,
 * honours `init.signal` the same way (rejecting with an `AbortError`), fails
 * with a `TypeError` on a network error like `fetch`, and resolves with a real
 * `Response`, so everything after the request is shared with the fetch path.
 *
 * One reporter for the whole upload: a resend after a token refresh is a
 * second call, and progress never goes backwards across it (as in the other
 * Rivium Storage SDKs).
 */
export function xhrTransport(onProgress: (progress: UploadProgress) => void): Transport {
  const report = createProgressReporter(onProgress);
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      let total = 0;
      const xhr = new XMLHttpRequest();
      const onAbortSignal = () => xhr.abort();
      const cleanup = () => signal?.removeEventListener('abort', onAbortSignal);

      xhr.open(init.method ?? 'GET', url, true);
      xhr.responseType = 'arraybuffer';
      for (const [name, value] of Object.entries(init.headers)) {
        xhr.setRequestHeader(name, value);
      }

      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (!e.lengthComputable || !(e.total > 0)) return;
        total = e.total;
        report(e.loaded, total);
      };
      xhr.upload.onload = (e: ProgressEvent) => {
        const size = total || (e.lengthComputable && e.total > 0 ? e.total : e.loaded);
        report(size, size, true);
      };

      xhr.onload = () => {
        cleanup();
        if (cameFromOtherOrigin(url, xhr.responseURL)) {
          reject(new TypeError('The request was redirected to another site, so the response was not used'));
          return;
        }
        const status = xhr.status;
        const body = NULL_BODY_STATUSES.has(status) ? null : (xhr.response as ArrayBuffer | null);
        try {
          resolve(
            new Response(body, {
              status,
              statusText: xhr.statusText,
              headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
            }),
          );
        } catch (e) {
          reject(e);
        }
      };
      xhr.onerror = () => {
        cleanup();
        reject(new TypeError('Failed to fetch'));
      };
      xhr.onabort = () => {
        cleanup();
        reject(abortError());
      };

      signal?.addEventListener('abort', onAbortSignal);
      xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null);
    });
}
