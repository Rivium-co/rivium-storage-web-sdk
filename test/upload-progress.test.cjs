// Upload progress: with onProgress the upload goes through XMLHttpRequest
// (fetch can't report upload progress) and must behave like the fetch path:
// same URL, headers and body, same errors, same token retry, same timeout.
// Runs against the compiled build: `npm test` builds first.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RiviumStorage, RiviumStorageException } = require('../dist/index.js');
const { createProgressReporter } = require('../dist/progress.js');

const API_KEY = 'rv_live_test';
const fileJson = {
  id: 'f1', bucketId: 'b1', path: 'a.txt', fileName: 'a.txt', mimeType: 'text/plain', size: 5,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

function jwt(expSecondsFromNow) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${b64({ alg: 'ES256' })}.${b64({ sub: 'user-1', exp })}.sig`;
}

/**
 * A hand-written XMLHttpRequest. Each send() takes the next plan:
 * { status, body, total, steps, networkError, hang }.
 */
class FakeXHR {
  constructor() {
    this.upload = {};
    this.requestHeaders = {};
    this.status = 0;
    this.statusText = '';
    this.response = null;
    this.aborted = false;
    FakeXHR.instances.push(this);
  }
  open(method, url, async) {
    this.method = method;
    this.url = url;
    this.async = async;
  }
  setRequestHeader(name, value) {
    this.requestHeaders[name] = value;
  }
  getAllResponseHeaders() {
    return 'content-type: application/json\r\nx-request-id: r1\r\n';
  }
  send(body) {
    this.body = body;
    const plan = FakeXHR.plans.shift() || { status: 200, body: fileJson };
    if (plan.hang) return;
    setTimeout(() => {
      if (this.aborted) return;
      const total = plan.total ?? 1000;
      const steps = plan.steps ?? 10;
      for (let i = 0; i <= steps; i++) {
        this.upload.onprogress?.({ lengthComputable: true, loaded: Math.round((total * i) / steps), total });
      }
      this.upload.onload?.({ lengthComputable: true, loaded: total, total });
      if (plan.networkError) return this.onerror?.();
      this.status = plan.status;
      this.statusText = 'X';
      this.response = new TextEncoder().encode(JSON.stringify(plan.body)).buffer;
      this.onload?.();
    }, 0);
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

const originalFetch = globalThis.fetch;
let fetchCalls;
let fetchResponses;

beforeEach(() => {
  FakeXHR.instances = [];
  FakeXHR.plans = [];
  globalThis.XMLHttpRequest = FakeXHR;
  fetchCalls = [];
  fetchResponses = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init, headers: { ...(init.headers || {}) } });
    const r = fetchResponses.shift() || { status: 200, body: fileJson };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.XMLHttpRequest;
});

/** FormData entries as plain values, files read to text. */
async function entries(formData) {
  const out = [];
  for (const [name, value] of formData.entries()) {
    out.push(typeof value === 'string'
      ? [name, value]
      : [name, { name: value.name, type: value.type, text: await value.text() }]);
  }
  return out;
}

test('progress events: in order, capped, final equals total exactly once', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  FakeXHR.plans = [{ status: 200, body: fileJson, total: 5000, steps: 10 }];
  const events = [];

  const file = await storage.upload('b1', 'a.txt', 'hello', { onProgress: (p) => events.push(p) });

  assert.equal(file.id, 'f1');
  assert.equal(fetchCalls.length, 0, 'fetch is not used when onProgress is given');
  assert.ok(events.length >= 3);
  for (const e of events) {
    assert.equal(e.totalBytes, 5000);
    assert.ok(e.bytesSent >= 0 && e.bytesSent <= e.totalBytes);
  }
  for (let i = 1; i < events.length; i++) assert.ok(events[i].bytesSent > events[i - 1].bytesSent);
  assert.deepEqual(events[events.length - 1], { bytesSent: 5000, totalBytes: 5000 });
  assert.equal(events.filter((e) => e.bytesSent === 5000).length, 1);
});

test('same URL, method, headers and body as the fetch path', async () => {
  const token = jwt(3600);
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => token });
  const options = { contentType: 'text/plain', metadata: { album: 'x' } };

  await storage.upload('b1', 'docs/a.txt', 'hello', options);
  await storage.upload('b1', 'docs/a.txt', 'hello', { ...options, onProgress: () => {} });

  const viaFetch = fetchCalls[0];
  const viaXhr = FakeXHR.instances[0];
  assert.equal(viaXhr.url, viaFetch.url);
  assert.equal(viaXhr.method, viaFetch.init.method);
  assert.equal(viaXhr.async, true);
  assert.deepEqual(viaXhr.requestHeaders, viaFetch.headers);
  assert.equal(viaXhr.requestHeaders['x-user-token'], token);
  assert.equal(viaXhr.requestHeaders['x-api-key'], API_KEY);
  assert.match(viaXhr.requestHeaders['X-Rivium-SDK'], /^web\//);
  assert.equal(viaXhr.requestHeaders['Content-Type'], undefined, 'the browser sets the multipart boundary');
  assert.ok(viaXhr.body instanceof FormData);
  assert.deepEqual(await entries(viaXhr.body), await entries(viaFetch.init.body));
});

test('server errors map to the same exception on both paths', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  const denied = { status: 403, body: { message: 'Denied by bucket rules', code: 'forbidden' } };
  fetchResponses = [denied];
  FakeXHR.plans = [denied];

  const errors = [];
  for (const options of [{}, { onProgress: () => {} }]) {
    await storage.upload('b1', 'a.txt', 'hello', options).catch((e) => errors.push(e));
  }

  assert.equal(errors.length, 2);
  for (const e of errors) assert.ok(e instanceof RiviumStorageException);
  assert.deepEqual(
    errors.map((e) => [e.statusCode, e.code, e.message]),
    [[403, 'forbidden', 'Denied by bucket rules'], [403, 'forbidden', 'Denied by bucket rules']],
  );
});

test('token_required through XMLHttpRequest waits, then userTokenWaitTimeout fails it with token_required', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c', userTokenWaitTimeout: 20 });
  FakeXHR.plans = [{ status: 401, body: { code: 'token_required', message: 'A user token is required' } }];

  await assert.rejects(storage.upload('b1', 'a.txt', 'hello', { onProgress: () => {} }), (e) => {
    assert.equal(e.statusCode, 401);
    assert.equal(e.code, 'token_required');
    assert.match(e.message, /userTokenWaitTimeout/);
    return true;
  });
});

test('401 token_expired: asks the provider again and retries once through XMLHttpRequest', async () => {
  const tokens = [jwt(3600), jwt(7200)];
  let asked = 0;
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: async () => tokens[asked++] });
  FakeXHR.plans = [
    // A resend carries the same body, so both attempts have the same size.
    { status: 401, body: { code: 'token_expired', message: 'expired' }, total: 800 },
    { status: 200, body: fileJson, total: 800 },
  ];
  const events = [];

  const file = await storage.upload('b1', 'a.txt', 'hello', { onProgress: (p) => events.push(p) });

  assert.equal(file.id, 'f1');
  assert.equal(asked, 2);
  assert.equal(FakeXHR.instances.length, 2);
  assert.equal(fetchCalls.length, 0);
  assert.equal(FakeXHR.instances[0].requestHeaders['x-user-token'], tokens[0]);
  assert.equal(FakeXHR.instances[1].requestHeaders['x-user-token'], tokens[1]);
  assert.equal(FakeXHR.instances[1].body, FakeXHR.instances[0].body, 'the same body is sent again');
  assert.deepEqual(events[events.length - 1], { bytesSent: 800, totalBytes: 800 });
  // One reporter for the whole upload: the resend never makes progress go backwards, one final event.
  for (let i = 1; i < events.length; i++) assert.ok(events[i].bytesSent >= events[i - 1].bytesSent, 'progress never goes backwards');
  assert.equal(events.filter((e) => e.bytesSent === e.totalBytes).length, 1, 'exactly one final event');
});

test('a second token_expired surfaces as an error, like fetch', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => jwt(3600) });
  FakeXHR.plans = [
    { status: 401, body: { code: 'token_expired' } },
    { status: 401, body: { code: 'token_expired', message: 'expired' } },
  ];

  await assert.rejects(storage.upload('b1', 'a.txt', 'hello', { onProgress: () => {} }), (e) => {
    assert.equal(e.statusCode, 401);
    assert.equal(e.code, 'token_expired');
    return true;
  });
  assert.equal(FakeXHR.instances.length, 2);
});

test('timeout: the request is aborted and fails with TIMEOUT', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c', timeout: 30 });
  FakeXHR.plans = [{ hang: true }];

  await assert.rejects(storage.upload('b1', 'a.txt', 'hello', { onProgress: () => {} }), (e) => {
    assert.ok(e instanceof RiviumStorageException);
    assert.equal(e.statusCode, 408);
    assert.equal(e.code, 'TIMEOUT');
    assert.equal(e.message, 'Request timeout');
    return true;
  });
  assert.equal(FakeXHR.instances[0].aborted, true);
});

test('network error maps to an upload error, like fetch', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  FakeXHR.plans = [{ networkError: true }];

  await assert.rejects(storage.upload('b1', 'a.txt', 'hello', { onProgress: () => {} }), (e) => {
    assert.ok(e instanceof RiviumStorageException);
    assert.equal(e.message, 'Upload error: Failed to fetch');
    assert.equal(e.statusCode, undefined);
    return true;
  });
});

test('without onProgress, uploads still use fetch and never XMLHttpRequest', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });

  await storage.upload('b1', 'a.txt', 'hello');

  assert.equal(fetchCalls.length, 1);
  assert.equal(FakeXHR.instances.length, 0);
});

test('a throwing onProgress does not break the upload', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  const originalError = console.error;
  console.error = () => {};
  try {
    const file = await storage.upload('b1', 'a.txt', 'hello', { onProgress: () => { throw new Error('ui'); } });
    assert.equal(file.id, 'f1');
  } finally {
    console.error = originalError;
  }
});

test('without XMLHttpRequest (a service worker): fetch, then one final event', async () => {
  delete globalThis.XMLHttpRequest;
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  const events = [];

  await storage.upload('b1', 'a.txt', 'hello', { onProgress: (p) => events.push(p) });

  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(events, [{ bytesSent: 5, totalBytes: 5 }]);
});

test('reporter: throttled, capped at the total, final exactly once', () => {
  let t = 0;
  const seen = [];
  const report = createProgressReporter((p) => seen.push(p.bytesSent), () => t);
  report(10, 10000); // first event always passes
  t = 10; report(20, 10000); // 10 ms and 0.1%: dropped
  t = 20; report(200, 10000); // 1.9% since last: passes
  t = 30; report(200, 10000); // same value: dropped
  t = 100; report(250, 10000); // 80 ms since last: passes
  report(20000, 10000); // over the total: becomes the final event
  report(10000, 10000, true); // already finished
  assert.deepEqual(seen, [10, 200, 250, 10000]);
});
