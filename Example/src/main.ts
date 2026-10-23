/**
 * Rivium Storage Web SDK example - every feature of @rivium/storage-web, wired to the page.
 * The SDK comes from ../ (file:../), so this page always runs the local, possibly unreleased, SDK source.
 */
import { RiviumStorage, RiviumStorageException, SDK_NAME, SDK_VERSION, StorageErrorCode } from '@rivium/storage-web';
import type { StorageFile, ImageTransforms } from '@rivium/storage-web';
import { config, configProblems, STORAGE_API } from './config';
import { demoServer, TestBuckets } from './demo-server';
import { storage, session, apiHeaders, decodeToken } from './storage';
import { $, action, onClick, show, showError, showWaitingForToken, el, describeError, TransformRefusal } from './ui';
import { makePng, makePdf, makeNoisePng, isPngNotAllowed, PNG_NOT_ALLOWED, formatBytes, loadImage, imageSize } from './samples';
import { ERROR_CASES, runErrorCase } from './errors';
import { runAllChecks } from './checks';

type Kind = 'public' | 'private';
const bucketName = (k: Kind) => (k === 'public' ? config.publicBucket : config.privateBucket);
const userFolder = () => `users/${session.userId}/`;

let testBuckets: TestBuckets | null = null;
/** The file the "current file" buttons work on. */
let current: { file: StorageFile; kind: Kind } | null = null;

// ----------------------------------------------------------------
// 1. Setup
// ----------------------------------------------------------------
$('sdk-version').textContent = `${SDK_NAME}/${SDK_VERSION}`;
const problems = configProblems();
if (problems.length) {
  const banner = $('setup-problems');
  banner.textContent = `Setup needed:\n- ${problems.join('\n- ')}`;
  banner.hidden = false;
}
const cfg = $('cfg');
for (const [k, v] of Object.entries({
  'Public key': config.apiKey ? `${config.apiKey.slice(0, 12)}...${config.apiKey.slice(-4)}` : '(missing)',
  'Example server': config.serverUrl,
  'Public bucket': config.publicBucket,
  'Private bucket': config.privateBucket,
  'Storage API (built into the SDK)': STORAGE_API,
  'Page origin (must be allowed)': location.origin,
})) {
  cfg.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
}

const outSetup = $('out-setup');
onClick('btn-health', outSetup, () => demoServer.health());
onClick('btn-setup-buckets', outSetup, async () => {
  testBuckets = await demoServer.setupTestBuckets();
  return testBuckets;
});

// ----------------------------------------------------------------
// 2. Sign in (tokenProvider)
// ----------------------------------------------------------------
const userInput = $<HTMLInputElement>('user-id');

// The awaiting state: true while file calls wait for a signed-in user. A real app shows its sign-in screen here.
const awaitingStatus = $('awaiting-status');
function showAwaiting() {
  // Why there is no token: the provider failed (e.g. the example server is not reachable), or no one is signed in.
  const why = session.lastProviderError
    ? `tokenProvider failed: ${session.lastProviderError.replace(/\.+$/, '')}`
    : session.signedIn
      ? 'tokenProvider returned no token'
      : 'signed out';
  awaitingStatus.textContent = storage.isAwaitingUserToken
    ? `isAwaitingUserToken: true (${why}) - file calls are waiting for a signed-in user. Sign in to let them go on.`
    : `isAwaitingUserToken: false${session.signedIn ? ' (signed in)' : ' (signed out - the next file call will wait)'}`;
  awaitingStatus.dataset.kind = storage.isAwaitingUserToken ? 'warn' : 'info';
  showWaitingForToken(
    storage.isAwaitingUserToken
      ? `Waiting for a user token (isAwaitingUserToken: true).\nWhy: ${why}.\nNothing was sent. Sign in (section 2) and this call goes on by itself.`
      : null,
  );
}
storage.onAwaitingUserToken(showAwaiting);
setInterval(showAwaiting, 500);
showAwaiting();
userInput.value = session.userId;
const outSignin = $('out-signin');

function tokenSummary() {
  if (session.lastProviderError) throw new Error(`tokenProvider failed: ${session.lastProviderError}`);
  const t = session.lastToken;
  return {
    signedIn: session.signedIn,
    userId: session.userId,
    providerCalls: session.providerCalls,
    token: t ? `${t.token.slice(0, 20)}...` : null,
    expiresAt: t?.expiresAt ?? null,
    claims: t ? decodeToken(t.token) : null,
  };
}

function refreshUserFolders() {
  $('up-folder').textContent = userFolder();
  $<HTMLInputElement>('ls-prefix').value = userFolder();
}

onClick('btn-signin', outSignin, async () => {
  session.userId = userInput.value.trim() || config.demoUserId;
  session.signedIn = true;
  session.lastToken = null;
  await storage.refreshUserToken(); // asks tokenProvider now
  refreshUserFolders();
  return tokenSummary();
});

onClick('btn-signout', outSignin, async () => {
  session.signedIn = false; // tokenProvider now returns null
  session.lastToken = null;
  await storage.refreshUserToken();
  return { ...tokenSummary(), note: 'Signed out: file calls (upload, listFiles, download, ...) now wait until you sign in again (isAwaitingUserToken). Bucket calls still work.' };
});

onClick('btn-set-token', outSignin, async () => {
  // A token you already hold (e.g. from Rivium Auth sign-in). With a provider it is used until it nears expiry.
  const minted = await demoServer.token(session.userId);
  await storage.setUserToken(minted.token);
  session.lastToken = minted;
  session.signedIn = true;
  const page = await storage.listFiles(config.publicBucket, { prefix: userFolder(), limit: 1 });
  return { setUserToken: 'done', thenListed: page.files.length, ...tokenSummary() };
});

onClick('btn-static-token', outSignin, async () => {
  // Option `userToken`: a fixed token, no provider - it cannot be renewed when it expires. Prefer tokenProvider.
  const minted = await demoServer.token(session.userId, 300);
  const fixed = new RiviumStorage({ apiKey: config.apiKey, userToken: minted.token });
  const page = await fixed.listFiles(config.publicBucket, { prefix: userFolder(), limit: 3 });
  await fixed.setUserToken(null); // without a provider, null clears it
  return { userTokenOption: 'listed with a fixed 5-minute token', files: page.files.map((f) => f.path), afterSetUserTokenNull: 'cleared' };
});

// ----------------------------------------------------------------
// 3. Calls wait until a user signs in (isAwaitingUserToken / onAwaitingUserToken)
// ----------------------------------------------------------------
const outWait = $('out-wait');
onClick('btn-wait', outWait, async () => {
  session.signedIn = false; // tokenProvider now returns null
  session.lastToken = null;
  await storage.refreshUserToken();
  const started = Date.now();
  storage
    .listFiles(config.publicBucket, { prefix: userFolder(), limit: 3 })
    .then((page) =>
      show(outWait, {
        listFiles: `completed after ${((Date.now() - started) / 1000).toFixed(1)} s of waiting`,
        files: page.files.map((f) => f.path),
        isAwaitingUserToken: storage.isAwaitingUserToken,
      }),
    )
    .catch((e) => showError(outWait, e));
  await new Promise((r) => setTimeout(r, 100));
  return {
    signedOut: true,
    isAwaitingUserToken: storage.isAwaitingUserToken,
    note: 'listFiles() is waiting: nothing was sent and it did not fail. Press "Sign in" in section 2 - it then completes by itself and shows its result here.',
  };
});

// ----------------------------------------------------------------
// 4. Buckets
// ----------------------------------------------------------------
const outBuckets = $('out-buckets');
onClick('btn-list-buckets', outBuckets, async () => (await storage.listBuckets()).map((b) => ({ id: b.id, name: b.name, visibility: b.visibility })));
onClick('btn-get-bucket', outBuckets, async () => {
  const id = testBuckets?.public.id ?? (await storage.getBucketByName(config.publicBucket)).id;
  return storage.getBucket(id);
});
onClick('btn-get-bucket-name', outBuckets, () => storage.getBucketByName(config.privateBucket));

// ----------------------------------------------------------------
// 5. Upload
// ----------------------------------------------------------------
const outUpload = $('out-upload');
const progress = $('up-progress');
refreshUserFolders();

function setCurrent(file: StorageFile, kind: Kind) {
  current = { file, kind };
  $('current-file').textContent = `${file.path} (${kind}, ${file.mimeType}, ${formatBytes(Number(file.size))}, id ${file.id})`;
}

function needCurrent(): { file: StorageFile; kind: Kind } {
  if (!current) throw new Error('No current file: upload one, or press "Use" next to a file in the list.');
  return current;
}

let hideProgressTimer: ReturnType<typeof setTimeout> | undefined;

async function doUpload(name: string, data: File | Blob | Uint8Array | string, contentType?: string): Promise<StorageFile> {
  const kind = $<HTMLSelectElement>('up-bucket').value as Kind;
  let metadata: Record<string, unknown> | undefined;
  const metaText = $<HTMLTextAreaElement>('up-metadata').value.trim();
  if (metaText) {
    try {
      metadata = JSON.parse(metaText);
    } catch {
      throw new Error('Metadata is not valid JSON.');
    }
  }
  const typeOverride = $<HTMLInputElement>('up-content-type').value.trim();
  const started = Date.now();
  const bar = progress.querySelector('div')!;
  const label = progress.querySelector('span')!;
  const showProgress = (bytesSent: number, totalBytes: number) => {
    const percent = totalBytes > 0 ? Math.floor((bytesSent / totalBytes) * 100) : 0;
    bar.style.width = `${percent}%`;
    progress.setAttribute('aria-valuenow', String(percent));
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    label.textContent = totalBytes === 0
      ? `Uploading ${name}...`
      : bytesSent < totalBytes
        ? `Uploading ${name}... ${percent}% (${formatBytes(bytesSent)} of ${formatBytes(totalBytes)}, ${seconds} s)`
        : `${name}: 100%, all ${formatBytes(totalBytes)} sent in ${seconds} s`;
  };
  clearTimeout(hideProgressTimer);
  showProgress(0, 0);
  progress.hidden = false;
  try {
    const file = await storage.upload(bucketName(kind), `${userFolder()}${name}`, data, {
      contentType: typeOverride || contentType || undefined,
      metadata,
      onProgress: ({ bytesSent, totalBytes }) => showProgress(bytesSent, totalBytes),
    });
    setCurrent(file, kind);
    return file;
  } finally {
    // Leave the full bar visible for a moment, so a fast upload is still seen.
    hideProgressTimer = setTimeout(() => (progress.hidden = true), 600);
  }
}

const fileInput = $<HTMLInputElement>('file-input');
const drop = $('drop-zone');
async function uploadChosen(f: File) {
  await action(null, outUpload, () => doUpload(f.name, f, f.type || undefined));
}
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void uploadChosen(f);
  fileInput.value = '';
});
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (f) void uploadChosen(f);
});

onClick('btn-up-string', outUpload, () => doUpload(`note-${Date.now()}.txt`, `Hello from the web example at ${new Date().toISOString()}`, 'text/plain'));
onClick('btn-up-bytes', outUpload, async () => doUpload(`gradient-${Date.now()}.png`, await makePng(64, 48), 'image/png'));
onClick('btn-up-unicode', outUpload, async () => doUpload('رسید-۸۸۱۲.pdf', makePdf('receipt 8812'), 'application/pdf'));
onClick('btn-up-spaces', outUpload, async () => doUpload('my holiday photo.png', await makePng(64, 48), 'image/png'));
// A ~5 MB PNG of noise pixels (a real image/png; random bytes would be application/octet-stream, which image-only buckets refuse).
onClick('btn-up-large', outUpload, async () => {
  try {
    return await doUpload(`progress-test-${Date.now()}.png`, await makeNoisePng(1200, 1200), 'image/png');
  } catch (e) {
    if (isPngNotAllowed(e)) return { skipped: PNG_NOT_ALLOWED, serverSaid: (e as Error).message };
    throw e;
  }
});

// ----------------------------------------------------------------
// 6. Files
// ----------------------------------------------------------------
const outFiles = $('out-files');
const tbody = $('files-body');
const nextBtn = $<HTMLButtonElement>('btn-next');
let nextCursor: string | null | undefined;
const selected = new Set<string>();

function renderFiles(list: StorageFile[], kind: Kind, append: boolean) {
  if (!append) {
    tbody.innerHTML = '';
    selected.clear();
  }
  if (!list.length && !append) {
    tbody.append(el('tr', {}, [el('td', { colSpan: 5, className: 'muted', textContent: 'No files under this prefix.' })]));
    return;
  }
  for (const f of list) {
    const box = el('input', { type: 'checkbox', ariaLabel: `Select ${f.path}` });
    box.addEventListener('change', () => (box.checked ? selected.add(f.id) : selected.delete(f.id)));
    const use = el('button', { className: 'small secondary', textContent: 'Use' });
    use.addEventListener('click', () => {
      setCurrent(f, kind);
      show(outFiles, { current: f });
    });
    const del = el('button', { className: 'small danger', textContent: 'delete(id)' });
    del.addEventListener('click', () =>
      void action(del, outFiles, async () => {
        await storage.delete(f.id);
        del.closest('tr')?.remove();
        return { deleted: f.path };
      }),
    );
    tbody.append(
      el('tr', {}, [
        el('td', {}, [box]),
        el('td', { className: 'path', textContent: f.path }),
        el('td', { textContent: f.mimeType }),
        el('td', { textContent: formatBytes(Number(f.size)) }),
        el('td', { className: 'actions' }, [use, del]),
      ]),
    );
  }
}

async function list(append: boolean) {
  const kind = $<HTMLSelectElement>('ls-bucket').value as Kind;
  const result = await storage.listFiles(bucketName(kind), {
    prefix: $<HTMLInputElement>('ls-prefix').value || undefined,
    limit: Number($<HTMLInputElement>('ls-limit').value) || undefined,
    cursor: append ? nextCursor : undefined,
  });
  nextCursor = result.nextCursor;
  nextBtn.disabled = !nextCursor;
  renderFiles(result.files, kind, append);
  return { files: result.files.length, nextCursor: result.nextCursor ?? null };
}
onClick('btn-list', outFiles, () => list(false));
onClick('btn-next', outFiles, () => list(true));

onClick('btn-delete-selected', outFiles, async () => {
  if (!selected.size) throw new Error('Tick one or more files first.');
  const result = await storage.deleteMany([...selected]);
  await list(false);
  return result;
});
onClick('btn-delete-path', outFiles, async () => {
  const path = $<HTMLInputElement>('del-path').value.trim();
  if (!path) throw new Error('Type a path, e.g. one from the list.');
  await storage.deleteByPath(bucketName($<HTMLSelectElement>('ls-bucket').value as Kind), path);
  return { deletedByPath: path };
});

onClick('btn-get-file', outFiles, async () => storage.getFile(needCurrent().file.id));
onClick('btn-get-by-path', outFiles, async () => {
  const c = needCurrent();
  return storage.getFileByPath(bucketName(c.kind), c.file.path);
});
onClick('btn-download', outFiles, async () => {
  const c = needCurrent();
  const data = await storage.download(c.file.id);
  const link = $<HTMLAnchorElement>('download-link');
  if (link.href.startsWith('blob:')) URL.revokeObjectURL(link.href);
  link.href = URL.createObjectURL(new Blob([data], { type: c.file.mimeType }));
  link.download = c.file.fileName || 'download';
  link.hidden = false;
  const isText = /^text\/|json/.test(c.file.mimeType);
  return { bytes: data.byteLength, preview: isText ? new TextDecoder().decode(data.slice(0, 400)) : '(binary - use the save link)' };
});
onClick('btn-delete', outFiles, async () => {
  const c = needCurrent();
  await storage.delete(c.file.id);
  current = null;
  $('current-file').textContent = 'none (deleted)';
  return { deleted: c.file.path };
});

// ----------------------------------------------------------------
// 7. Show an image the right way
// ----------------------------------------------------------------
const outShow = $('out-show');
const blobUrls: Record<string, string> = {};
function setBlob(img: HTMLImageElement, blob: Blob) {
  if (blobUrls[img.id]) URL.revokeObjectURL(blobUrls[img.id]);
  blobUrls[img.id] = URL.createObjectURL(blob);
  return loadImage(img, blobUrls[img.id]);
}

async function publicLink(fileId: string): Promise<string> {
  // getUrl() is the API address GET /files/:id/url; it needs the key and answers { url } (403 for a private file).
  const res = await fetch(storage.getUrl(fileId), { headers: { 'x-api-key': config.apiKey } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new RiviumStorageException(body.message || `HTTP ${res.status}`, res.status, body.code);
  return body.url as string;
}

onClick('btn-show-public', outShow, async () => {
  const c = needCurrent();
  const url = await publicLink(c.file.id);
  const size = await loadImage($<HTMLImageElement>('img-public'), url);
  return { publicUrl: url, shown: `${size.width}x${size.height}`, why: 'A public link needs no headers, so it works in <img src>.' };
});
onClick('btn-show-download', outShow, async () => {
  const c = needCurrent();
  const data = await storage.download(c.file.id);
  const size = await setBlob($<HTMLImageElement>('img-download'), new Blob([data], { type: c.file.mimeType }));
  return { downloaded: data.byteLength, shown: `${size.width}x${size.height}`, why: 'download() sends the key and the user token, so the rules apply; works for private files.' };
});
onClick('btn-show-signed', outShow, async () => {
  const c = needCurrent();
  const { url, expiresIn } = await demoServer.signedUrl(c.file.id, 600);
  const size = await loadImage($<HTMLImageElement>('img-signed'), url);
  return { signedUrl: `${url.split('?')[0]}?...`, expiresIn, shown: `${size.width}x${size.height}`, why: 'Your server signs a time-limited link (server secret); no headers needed.' };
});
onClick('btn-show-wrong', outShow, async () => {
  const c = needCurrent();
  const url = storage.getUrl(c.file.id);
  try {
    await loadImage($<HTMLImageElement>('img-wrong'), url);
    return { unexpected: 'it loaded', url };
  } catch {
    return {
      src: url,
      result: 'broken image, as expected',
      why: 'An <img> sends no x-api-key header, so the API answers 401 - and this address returns JSON ({ url }), not the image. getDownloadUrl() and getTransformUrl() have the same problem.',
    };
  }
});

// ----------------------------------------------------------------
// 8. Links
// ----------------------------------------------------------------
const outLinks = $('out-links');
onClick('btn-public-url', outLinks, async () => {
  const c = needCurrent();
  const api = storage.getUrl(c.file.id);
  const url = await publicLink(c.file.id); // 403 "File is not in a public bucket" for a private file
  return { getUrl: api, answer: { url } };
});
onClick('btn-download-url', outLinks, async () => {
  const c = needCurrent();
  const url = storage.getDownloadUrl(c.file.id);
  const res = await fetch(url, { headers: await apiHeaders() });
  if (!res.ok) throw new RiviumStorageException(`HTTP ${res.status}`, res.status);
  return { getDownloadUrl: url, fetchedWithHeaders: `${res.status}, ${res.headers.get('content-type')}, ${(await res.blob()).size} B`, note: 'For code only: it needs x-api-key (+ x-user-token).' };
});
onClick('btn-signed-url', outLinks, async () => {
  const c = needCurrent();
  const { url, expiresIn } = await demoServer.signedUrl(c.file.id, 600);
  window.open(url, '_blank', 'noopener');
  return { opened: `${url.split('?')[0]}?...`, expiresIn };
});

onClick('btn-signed-upload', $('out-signed-upload'), async () => {
  const f = $<HTMLInputElement>('signed-file').files?.[0];
  if (!f) throw new Error('Choose a file first.');
  const kind = $<HTMLSelectElement>('signed-bucket').value as Kind;
  const contentType = f.type || 'application/octet-stream';
  const link = await demoServer.signedUpload({ bucket: kind, contentType, userId: session.userId, fileName: f.name });
  let put: Response;
  try {
    put = await fetch(link.url, { method: 'PUT', headers: link.headers, body: f });
  } catch (e) {
    throw new Error(`The PUT to storage was blocked (${(e as Error).message}). Browser uploads to a signed link need CORS on the storage bucket for ${location.origin}.`);
  }
  if (!put.ok) throw new Error(`PUT answered ${put.status}: ${await put.text()}`);
  const confirmed = await demoServer.confirmUpload(kind, link.path);
  const file = await storage.getFileByPath(bucketName(kind), link.path);
  setCurrent(file, kind);
  return { link: { ...link, url: `${link.url.split('?')[0]}?...` }, put: put.status, confirmed: confirmed.id, file };
});

// ----------------------------------------------------------------
// 9. Transforms
// ----------------------------------------------------------------
const outTransform = $('out-transform');
const num = (id: string) => {
  const v = $<HTMLInputElement>(id).value;
  return v === '' ? undefined : Number(v);
};
function readTransforms(): ImageTransforms {
  const t: ImageTransforms = {
    width: num('tf-width'),
    height: num('tf-height'),
    fit: $<HTMLSelectElement>('tf-fit').value || undefined,
    format: $<HTMLSelectElement>('tf-format').value || undefined,
    quality: num('tf-quality'),
    blur: num('tf-blur'),
    sharpen: num('tf-sharpen'),
    rotate: num('tf-rotate'),
  };
  return t;
}
function setTransforms(t: ImageTransforms) {
  const set = (id: string, v: unknown) => (($(id) as HTMLInputElement).value = v === undefined ? '' : String(v));
  set('tf-width', t.width);
  set('tf-height', t.height);
  set('tf-fit', t.fit);
  set('tf-format', t.format);
  set('tf-quality', t.quality);
  set('tf-blur', t.blur);
  set('tf-sharpen', t.sharpen);
  set('tf-rotate', t.rotate);
}
const presets: Record<string, ImageTransforms> = {
  avatar: { width: 100, height: 100, fit: 'cover', format: 'webp', quality: 80 },
  placeholder: { width: 20, blur: 10, quality: 30, format: 'jpeg' },
  rotate: { rotate: 90, format: 'png' },
  avif: { width: 400, format: 'avif', quality: 50 },
};

async function transform() {
  const c = needCurrent();
  if (!c.file.mimeType.startsWith('image/')) throw new Error(`The current file is ${c.file.mimeType}; transforms need an image.`);
  const t = readTransforms();
  const url = storage.getTransformUrl(c.file.id, t);
  $('tf-url').textContent = url;
  const res = await fetch(url, { headers: await apiHeaders() });
  // A refusal reads code + message from the JSON body: a title and a hint, never the raw body.
  if (!res.ok) throw await TransformRefusal.from(res);
  const blob = await res.blob();
  const img = $<HTMLImageElement>('img-transform');
  let shown = '';
  try {
    const size = await setBlob(img, blob);
    shown = `${size.width}x${size.height}`;
  } catch {
    shown = `this browser cannot display ${blob.type}`;
  }
  const decoded = await imageSize(blob).catch(() => null);
  $('tf-caption').textContent = `${res.headers.get('content-type')}, ${formatBytes(blob.size)}, ${shown}`;
  return {
    options: t,
    url,
    contentType: res.headers.get('content-type'),
    bytes: blob.size,
    originalBytes: Number(c.file.size),
    size: decoded ? `${decoded.width}x${decoded.height}` : shown,
  };
}
onClick('btn-transform', outTransform, transform);

// Public bucket: header-free link. getPublicUrl(id, options) -> a plain <img src>, no headers.
const outTransformPublic = $('out-transform-public');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Why a public image URL didn't load. An <img> can't tell, so this asks the URL itself (no headers, as the <img> did).
 * null when the browser can't read the answer (public links send no CORS header for every page).
 */
async function publicRefusal(url: string): Promise<TransformRefusal | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? null : await TransformRefusal.from(res);
  } catch {
    return null;
  }
}

async function transformPublic() {
  const c = needCurrent();
  if (c.kind !== 'public') {
    throw new Error('The current file is in the private bucket, which has no public link (403). Upload an image to the public bucket (section 5) and try again.');
  }
  if (!c.file.mimeType.startsWith('image/')) throw new Error(`The current file is ${c.file.mimeType}; transforms need an image.`);
  const t = readTransforms();
  // invalid_transform before any request; 403 for a private bucket.
  const url = await storage.getPublicUrl(c.file.id, t);
  $('tf-public-url').textContent = url;
  const img = $<HTMLImageElement>('img-transform-public');
  for (let attempt = 1; ; attempt++) {
    try {
      // A plain <img src>: no x-api-key, no user token.
      const size = await loadImage(img, url);
      $('tf-public-caption').textContent = `${size.width}x${size.height}, public link, no headers`;
      return { options: t, url, shown: `${size.width}x${size.height}`, attempt, why: 'A public link (with or without transform options) needs no headers, so it works in <img src> and is cached by the CDN.' };
    } catch {
      const refusal = await publicRefusal(url);
      if (refusal?.code === StorageErrorCode.TransformBusy && attempt === 1) {
        const wait = refusal.retryAfter ?? 2;
        show(outTransformPublic, `Busy, retrying... (in ${wait} s, as Retry-After says)`, 'info');
        await sleep(wait * 1000);
        continue;
      }
      if (refusal) throw refusal;
      throw new Error(`The image didn't load. The browser can't read why (public links send no CORS header for this page): open the URL in a new tab to see the answer.\n${url}`);
    }
  }
}
onClick('btn-transform-public', outTransformPublic, transformPublic);
for (const b of Array.from($('tf-presets').querySelectorAll<HTMLButtonElement>('button[data-preset]'))) {
  b.addEventListener('click', () => {
    setTransforms(presets[b.dataset.preset!]);
    void action(b, outTransform, transform);
  });
}

// ----------------------------------------------------------------
// 10. Errors
// ----------------------------------------------------------------
const outErrors = $('out-errors');
const errorButtons = $('error-buttons');
for (const c of ERROR_CASES) {
  const b = el('button', { className: 'secondary', textContent: c.label, title: c.explain });
  b.addEventListener('click', () =>
    void action(b, outErrors, async () => {
      const privateMaxSize = Number(testBuckets?.private.maxFileSize ?? (await storage.getBucketByName(config.privateBucket)).maxFileSize ?? 1048576);
      const r = await runErrorCase(c, { userId: session.userId, folder: `${userFolder()}web-example/errors/`, privateMaxSize });
      if (r.uploadedId) await storage.delete(r.uploadedId).catch((e) => showError(outErrors, e));
      const text = `${c.label}: ${c.explain}\n\n${r.text}`;
      if (!r.ok) throw new Error(text);
      return text;
    }),
  );
  errorButtons.append(b);
}

// ----------------------------------------------------------------
// 11. Run all checks
// ----------------------------------------------------------------
const runBtn = $<HTMLButtonElement>('btn-run-checks');
runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  try {
    await runAllChecks($<HTMLOListElement>('checks-list'), $('checks-summary'), $<HTMLInputElement>('chk-slow').checked);
  } catch (e) {
    $('checks-summary').textContent = `Stopped: ${describeError(e)}`;
  } finally {
    runBtn.disabled = false;
  }
});
