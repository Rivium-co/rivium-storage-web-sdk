// Upload content types and server refusals as the app sees them: the type the
// multipart file part carries when no contentType is passed, and the server's
// `code`, `statusCode` and message on every path (fetch upload, XMLHttpRequest
// upload with onProgress, download, other requests).
// Runs against the compiled build: `npm test` builds first.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RiviumStorage, RiviumStorageException, StorageErrorCode } = require('../dist/index.js');

const API_KEY = 'rv_live_test';
const fileJson = {
  id: 'f1', bucketId: 'b1', path: 'a.txt', fileName: 'a.txt', mimeType: 'text/plain', size: 5,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

/** A minimal XMLHttpRequest answering with the next planned response. */
class FakeXHR {
  constructor() { this.upload = {}; this.headers = {}; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(n, v) { this.headers[n] = v; }
  getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
  abort() {}
  send(body) {
    this.body = body;
    sent.push(this);
    const r = plans.shift() || { status: 200, body: fileJson };
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
      this.upload.onload?.({ lengthComputable: true, loaded: 10, total: 10 });
      this.status = r.status;
      this.statusText = 'X';
      this.response = new TextEncoder().encode(JSON.stringify(r.body)).buffer;
      this.onload?.();
    }, 0);
  }
}

const originalFetch = globalThis.fetch;
let plans;
let sent;

beforeEach(() => {
  plans = [];
  sent = [];
  globalThis.XMLHttpRequest = FakeXHR;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: init.body });
    const r = plans.shift() || { status: 200, body: fileJson };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.XMLHttpRequest;
});

/** The `file` part of the last request's FormData. */
function filePart() {
  const body = sent[sent.length - 1].body;
  return body.get('file');
}

// ---------- content type ----------

test('no contentType: the table type for the extension (string, bytes, Blob, File)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  const cases = [
    ['notes/a.md', '# hi', 'text/markdown'],
    ['data/a.CSV', new Uint8Array([97, 44, 98]), 'text/csv'],
    ['a.yml', new Blob(['a: 1']), 'text/yaml'],
    ['photo.heic', new File([new Uint8Array(4)], 'photo.heic'), 'image/heic'],
    ['backup.tar.gz', new Uint8Array(3), 'application/gzip'],
    ['voice.wav', new Uint8Array(3), 'audio/vnd.wave'],
  ];
  for (const [path, data, type] of cases) {
    await storage.upload('b1', path, data);
    const part = filePart();
    assert.equal(part.type, type, path);
    assert.equal(part.name, path.split('/').pop());
  }
});

test('the table wins over the browser type of a known extension (Windows .csv)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  const file = new File(['a,b\n1,2'], 'sheet.csv', { type: 'application/vnd.ms-excel' });
  await storage.upload('b1', 'sheet.csv', file);
  assert.equal(filePart().type, 'text/csv');
  assert.equal(await filePart().text(), 'a,b\n1,2', 'the bytes are unchanged');
});

test('unknown extension: the File / Blob type, else application/octet-stream', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.upload('b1', 'avatars/me', new File([new Uint8Array(4)], 'x.png', { type: 'image/png' }));
  assert.equal(filePart().type, 'image/png');
  await storage.upload('b1', 'notes.unknownext', new Blob(['x'], { type: 'text/plain' }));
  assert.equal(filePart().type, 'text/plain');
  await storage.upload('b1', 'README', 'hello');
  assert.equal(filePart().type, 'application/octet-stream');
  await storage.upload('b1', '.config/settings', new Uint8Array(1));
  assert.equal(filePart().type, 'application/octet-stream');
});

test('an explicit contentType always wins', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.upload('b1', 'a.md', '# x', { contentType: 'text/x-markdown' });
  assert.equal(filePart().type, 'text/x-markdown');
  await storage.upload('b1', 'a.csv', new File(['a'], 'a.csv', { type: 'text/plain' }), { contentType: 'application/csv' });
  assert.equal(filePart().type, 'application/csv');
});

test('the XMLHttpRequest path sends the same type', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.upload('b1', 'a.json', '{}', { onProgress: () => {} });
  assert.ok(sent[0] instanceof FakeXHR);
  assert.equal(sent[0].body.get('file').type, 'application/json');
});

// ---------- error codes ----------

const REFUSALS = [
  [400, StorageErrorCode.TypeNotAllowed, 'This bucket does not allow text/markdown files'],
  [400, StorageErrorCode.FileTooLarge, 'File is larger than the bucket limit (1 MB)'],
  [400, StorageErrorCode.ExecutableBlocked, 'Executable files are blocked in this bucket'],
  [401, StorageErrorCode.TokenInvalid, 'Invalid user token'],
  [401, StorageErrorCode.TokenExpired, 'User token expired - refresh it and retry'],
  [409, StorageErrorCode.PathTaken, 'A file already exists at this path'],
];

function refusal(status, code, message) {
  return { status, body: { statusCode: status, error: 'Bad Request', message, code } };
}

async function rejects(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  assert.fail('expected a rejection');
}

for (const progress of [false, true]) {
  const via = progress ? 'XMLHttpRequest (onProgress)' : 'fetch';
  test(`upload via ${via}: code, statusCode and server message reach the app`, async () => {
    const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
    for (const [status, code, message] of REFUSALS) {
      plans.push(refusal(status, code, message));
      const e = await rejects(storage.upload('b1', 'a.md', '# x', progress ? { onProgress: () => {} } : {}));
      assert.ok(e instanceof RiviumStorageException);
      assert.equal(e.code, code);
      assert.equal(e.statusCode, status);
      assert.equal(e.message, message);
    }
  });

  test(`upload via ${via}: token_required waits, then userTokenWaitTimeout fails it with token_required`, async () => {
    const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c', userTokenWaitTimeout: 20 });
    plans.push(refusal(401, 'token_required', 'User token required'));
    const e = await rejects(storage.upload('b1', 'a.md', '# x', progress ? { onProgress: () => {} } : {}));
    assert.equal(e.code, StorageErrorCode.TokenRequired);
    assert.equal(e.statusCode, 401);
    assert.match(e.message, /setUserToken\(\) or refreshUserToken\(\)/);
    assert.equal(storage.isAwaitingUserToken, false);
  });
}

test('upload: a 403 rule denial keeps its status and message (no code)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  plans.push({ status: 403, body: { statusCode: 403, message: 'Access denied by bucket rules' } });
  const e = await rejects(storage.upload('b1', 'a.md', '# x'));
  assert.equal(e.statusCode, 403);
  assert.equal(e.code, undefined);
  assert.equal(e.message, 'Access denied by bucket rules');
});

test('upload: a validation message array is joined', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  plans.push({ status: 400, body: { statusCode: 400, message: ['path is required', 'path too long'] } });
  const e = await rejects(storage.upload('b1', 'a.md', '# x'));
  assert.equal(e.message, 'path is required, path too long');
});

test('download: the server message and code are kept', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  for (const [status, code, message] of [
    [401, StorageErrorCode.TokenExpired, 'User token expired - refresh it and retry'],
    [403, undefined, 'Access denied by bucket rules'],
    [404, undefined, 'File not found'],
  ]) {
    plans.push({ status, body: { statusCode: status, message, ...(code ? { code } : {}) } });
    const e = await rejects(storage.download('f1'));
    assert.equal(e.statusCode, status);
    assert.equal(e.code, code);
    assert.equal(e.message, message);
  }
});

test('download: no JSON body falls back to "Download failed: <status>"', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  globalThis.fetch = async () => new Response('Bad gateway', { status: 502 });
  const e = await rejects(storage.download('f1'));
  assert.equal(e.statusCode, 502);
  assert.equal(e.message, 'Download failed: 502');
});

test('other requests: the code is kept (getFile)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  plans.push(refusal(401, 'token_invalid', 'Invalid user token'));
  const e = await rejects(storage.getFile('f1'));
  assert.equal(e.code, 'token_invalid');
  assert.equal(e.statusCode, 401);
});

// ---------- image transform refusals ----------
// The SDK only builds transform URLs (the app fetches them); these are the
// bodies the transform route answers with. The SDK's own requests read them
// the same way, so code, statusCode and message reach the app.

const TRANSFORM_REFUSALS = [
  [415, StorageErrorCode.ImageFormatNotSupported,
    "This image format can't be resized: BMP. Supported: JPEG, PNG, WebP, GIF, AVIF, HEIC, TIFF, SVG."],
  [400, StorageErrorCode.NotAnImage, "This file isn't an image (application/pdf), so it can't be resized."],
  [422, StorageErrorCode.ImageDamaged, 'The image is damaged or incomplete (it may not have finished uploading).'],
  [413, StorageErrorCode.ImageTooLarge, 'This image is 12000×9000 (108 MP); images up to 50 MP can be resized.'],
];

test('transform refusals (415, 400, 422, 413): code, statusCode and message reach the app (download, getFile)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  for (const [status, code, message] of TRANSFORM_REFUSALS) {
    plans.push(refusal(status, code, message));
    let e = await rejects(storage.download('f1'));
    assert.equal(e.statusCode, status);
    assert.equal(e.code, code);
    assert.equal(e.message, message);
    plans.push(refusal(status, code, message));
    e = await rejects(storage.getFile('f1'));
    assert.equal(e.statusCode, status);
    assert.equal(e.code, code);
    assert.equal(e.message, message);
  }
});
