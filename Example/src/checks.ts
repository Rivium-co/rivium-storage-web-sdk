/**
 * "Run all checks": every feature in order, as the signed-in user, with pass / fail per step and a cleanup at the end.
 */
import { RiviumStorage, RiviumStorageException, SDK_VERSION, contentTypeForPath } from '@rivium/storage-web';
import type { StorageFile, ImageTransforms } from '@rivium/storage-web';
import { config } from './config';
import { demoServer, TestBuckets } from './demo-server';
import { storage, session, apiHeaders, decodeToken, tokenProvider } from './storage';
import { makePng, makePdf, makeNoisePng, pngHeaderSize, isPngNotAllowed, isTypeNotAllowed, PNG_NOT_ALLOWED, sameBytes, imageSize, loadImage } from './samples';
import { ERROR_CASES, runErrorCase, ErrorContext } from './errors';
import { describeError, TransformRefusal } from './ui';
import { BucketSetup, BucketFacts, SETUP_ONE_LINER } from './bucket-setup';

interface Check {
  name: string;
  run: () => Promise<string | void>;
  /** The bucket setting this check needs (from "Bucket setup"): a string = SKIP with that hint instead of running. */
  needs?: (setup: BucketSetup) => string | null;
}

/** Thrown by a check that cannot run here (shown as SKIP, not FAIL). */
class Skip extends Error {}

/** Thrown by a check that ran but found something to change (the bucket setup): shown as WARN, not FAIL. */
class Warn extends Error {}

function need<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Skip(`needs ${what} from an earlier step`);
  return v;
}

/** One test bucket, read with the SDK (the public key may read buckets). 404 = it doesn't exist. */
async function readBucket(name: string): Promise<BucketFacts> {
  try {
    const b = await storage.getBucketByName(name);
    // blockExecutables: the SDK's Bucket type doesn't list it yet; newer APIs send it, older ones don't (= unknown).
    const block = (b as unknown as { blockExecutables?: unknown }).blockExecutables;
    return {
      name,
      found: true,
      visibility: b.visibility,
      allowedMimeTypes: b.allowedMimeTypes ?? null,
      maxFileSize: b.maxFileSize != null ? Number(b.maxFileSize) : null,
      blockExecutables: typeof block === 'boolean' ? block : null,
    };
  } catch (e) {
    if (e instanceof RiviumStorageException && e.statusCode === 404) return { name, found: false };
    throw e;
  }
}

function expect(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAllChecks(list: HTMLOListElement, summary: HTMLElement, slow: boolean): Promise<void> {
  list.innerHTML = '';
  summary.textContent = 'Running...';

  const runId = Date.now().toString(36);
  const uid = session.userId;
  const folder = `users/${uid}/web-example/${runId}/`;
  const created = new Set<string>(); // file ids to delete at the end
  const files: Record<string, StorageFile> = {};
  const bytes: Record<string, Uint8Array> = {};
  let buckets: TestBuckets | null = null;
  // The "Bucket setup" result. null (that check failed) = the dependent checks run as they are.
  let setup: BucketSetup | null = null;
  let png: Uint8Array | null = null;
  const img = new Image();

  const keep = (key: string, f: StorageFile, data: Uint8Array) => {
    files[key] = f;
    bytes[key] = data;
    created.add(f.id);
    return { id: f.id, path: f.path, mimeType: f.mimeType, size: Number(f.size) };
  };
  const file = (key: string) => need(files[key], `the "${key}" upload`);

  const checks: Check[] = [
    {
      name: 'Bucket setup (compared with what the checks expect)',
      run: async () => {
        const s = new BucketSetup(await readBucket(config.publicBucket), await readBucket(config.privateBucket));
        setup = s;
        const diffs = s.differences();
        const unknown = s.unknowns();
        if (diffs.length) {
          throw new Warn([`${diffs.length} difference(s) from the expected setup; the checks that need these settings are skipped:`, ...diffs.map((d) => `- ${d}`), ...unknown.map((u) => `- ${u}`), SETUP_ONE_LINER].join('\n'));
        }
        return [`${config.publicBucket}: public, allows every type the checks use; ${config.privateBucket}: private, images only, max ${s.priv.maxFileSize} B; executables blocked`, ...unknown, 'Access rules are not readable with the public key (setup-buckets applies "users\' own folders").'].join('\n');
      },
    },
    { name: 'Example server is up', run: async () => JSON.stringify(await demoServer.health()) },
    {
      name: 'Test buckets ready (POST /setup-test-buckets)',
      run: async () => {
        buckets = await demoServer.setupTestBuckets();
        expect(buckets.public.name === config.publicBucket && buckets.private.name === config.privateBucket,
          `the server uses ${buckets.public.name} / ${buckets.private.name}, this page ${config.publicBucket} / ${config.privateBucket} - make the names match`);
        return `${buckets.public.name}, ${buckets.private.name}${buckets.warnings.length ? `; warnings: ${buckets.warnings.join(' ')}` : ''}`;
      },
    },
    {
      name: 'Sign in: tokenProvider via POST /token, refreshUserToken()',
      run: async () => {
        session.signedIn = true;
        await storage.refreshUserToken();
        if (session.lastProviderError) throw new Error(`tokenProvider failed: ${session.lastProviderError}`);
        const t = need(session.lastToken, 'a token');
        const claims = decodeToken(t.token);
        expect(claims.sub === uid, `token is for ${claims.sub}, expected ${uid}`);
        return `token for ${claims.sub}, expires ${t.expiresAt}`;
      },
    },
    {
      name: 'Calls wait until sign-in: sign out -> listFiles() waits -> sign in -> it completes',
      run: async () => {
        let fired = 0;
        const unsubscribe = storage.onAwaitingUserToken(() => fired++);
        try {
          session.signedIn = false; // tokenProvider now returns null
          session.lastToken = null;
          await storage.refreshUserToken();
          const pending = storage.listFiles(config.publicBucket, { prefix: `users/${uid}/`, limit: 1 });
          await new Promise((r) => setTimeout(r, 300));
          expect(storage.isAwaitingUserToken, 'isAwaitingUserToken should be true while signed out');
          expect(fired === 1, `onAwaitingUserToken fired ${fired} time(s), expected 1`);
          session.signedIn = true;
          await storage.refreshUserToken(); // the provider returns a token again: the waiting call goes on
          const page = await pending;
          expect(!storage.isAwaitingUserToken, 'isAwaitingUserToken should be false after sign-in');
          return `waited (isAwaitingUserToken true, onAwaitingUserToken once), then listed ${page.files.length} file(s) after sign-in`;
        } finally {
          unsubscribe();
          session.signedIn = true;
        }
      },
    },
    {
      name: 'listBuckets()',
      run: async () => {
        const list = await storage.listBuckets();
        expect(list.some((b) => b.name === config.publicBucket) && list.some((b) => b.name === config.privateBucket), 'test buckets missing');
        return `${list.length} bucket(s)`;
      },
    },
    {
      name: 'getBucket(id), getBucketByName(name)',
      run: async () => {
        const b = await storage.getBucket(need(buckets, 'the buckets').public.id);
        const p = await storage.getBucketByName(config.privateBucket);
        expect(b.name === config.publicBucket, 'wrong bucket by id');
        return `${b.name} (${b.visibility}); ${p.name} (${p.visibility}, ${p.allowedMimeTypes?.join(', ')}, max ${p.maxFileSize} B)`;
      },
    },
    {
      name: 'upload(string, { contentType, metadata })',
      run: async () => {
        const text = `Hello from the web example, run ${runId}`;
        const f = await storage.upload(config.publicBucket, `${folder}hello.txt`, text, { contentType: 'text/plain', metadata: { source: 'web-example', runId } });
        expect((f.metadata as Record<string, unknown> | undefined)?.runId === runId, 'metadata did not come back');
        return JSON.stringify(keep('text', f, new TextEncoder().encode(text)));
      },
      needs: (b) => b.publicAllows('text/plain'),
    },
    {
      name: 'upload(Uint8Array) - PNG to the public bucket',
      run: async () => {
        png = await makePng(64, 48);
        return JSON.stringify(keep('png', await storage.upload(config.publicBucket, `${folder}gradient.png`, png, { contentType: 'image/png' }), png));
      },
      needs: (b) => b.publicAllows('image/png'),
    },
    {
      name: 'upload(File) - PNG to the private bucket',
      run: async () => {
        const data = need(png, 'the PNG');
        const f = new File([data], 'private.png', { type: 'image/png' });
        return JSON.stringify(keep('private', await storage.upload(config.privateBucket, `${folder}private.png`, f), data));
      },
      needs: (b) => b.privateAllowsPng(),
    },
    {
      name: 'upload: Unicode name رسید-۸۸۱۲.pdf',
      run: async () => {
        const data = makePdf('receipt 8812');
        return JSON.stringify(keep('unicode', await storage.upload(config.publicBucket, `${folder}رسید-۸۸۱۲.pdf`, data, { contentType: 'application/pdf' }), data));
      },
      needs: (b) => b.publicAllows('application/pdf'),
    },
    {
      name: 'upload: name with spaces (my holiday photo.png)',
      run: async () => {
        const data = need(png, 'the PNG');
        return JSON.stringify(keep('spaces', await storage.upload(config.publicBucket, `${folder}my holiday photo.png`, new Blob([data], { type: 'image/png' })), data));
      },
      needs: (b) => b.publicAllows('image/png'),
    },
    {
      name: 'listFiles({ prefix, limit: 2 }) + cursor paging',
      run: async () => {
        for (const k of ['text', 'png', 'unicode', 'spaces']) need(files[k], `the "${k}" upload`);
        const pages: number[] = [];
        let cursor: string | null | undefined;
        do {
          const page = await storage.listFiles(config.publicBucket, { prefix: folder, limit: 2, cursor });
          pages.push(page.files.length);
          cursor = page.nextCursor;
        } while (cursor && pages.length < 20);
        const total = pages.reduce((a, b) => a + b, 0);
        expect(total === 4, `listed ${total}, expected 4`);
        return `pages: ${pages.join(' + ')}`;
      },
    },
    {
      name: 'upload progress reaches 100% (5 MB PNG, onProgress)',
      run: async () => {
        // A real PNG of noise pixels: random bytes would be application/octet-stream, which buckets that allow only images refuse.
        const data = await makeNoisePng(1200, 1200);
        const header = pngHeaderSize(data);
        expect(header?.width === 1200 && header?.height === 1200, `generated PNG header says ${JSON.stringify(header)}, expected 1200x1200`);
        expect(data.length >= 2 * 1024 * 1024, `generated PNG is only ${data.length} bytes`);
        const events: { bytesSent: number; totalBytes: number }[] = [];
        const started = Date.now();
        let f: StorageFile;
        try {
          f = await storage.upload(config.publicBucket, `${folder}progress-test.png`, data, {
            contentType: 'image/png',
            onProgress: (p) => events.push(p),
          });
        } catch (e) {
          if (isPngNotAllowed(e)) throw new Skip(PNG_NOT_ALLOWED);
          throw e;
        }
        keep('large', f, data);
        expect(events.length > 0, 'onProgress was never called');
        const last = events[events.length - 1];
        expect(last.bytesSent === last.totalBytes, `last event ${last.bytesSent} of ${last.totalBytes}`);
        expect(last.totalBytes >= data.length, `totalBytes ${last.totalBytes} is smaller than the file (${data.length})`);
        expect(events.every((e, i) => e.bytesSent <= e.totalBytes && e.totalBytes === last.totalBytes && (i === 0 || e.bytesSent > events[i - 1].bytesSent)),
          'events went backwards, above the total, or changed the total');
        expect(events.filter((e) => e.bytesSent === e.totalBytes).length === 1, 'more than one final event');
        expect(Number(f.size) === data.length, `stored ${f.size} bytes, sent ${data.length}`);
        return `${events.length} event(s), ${last.bytesSent} of ${last.totalBytes} bytes, ${((Date.now() - started) / 1000).toFixed(1)} s`;
      },
      needs: (b) => b.publicAllows('image/png'),
    },
    {
      name: 'file types: .json / .csv / .md upload with no contentType',
      run: async () => {
        // No contentType: the SDK sends the type the file types table lists for the extension (the one the Console
        // offers in a bucket's allowed types), and the server stores exactly that.
        const cases: Array<[string, string | Blob | File, string]> = [
          ['data.json', JSON.stringify({ runId }), 'application/json'],
          ['table.csv', new Blob(['name,score\nada,3\n']), 'text/csv'],
          ['notes.md', new File([`# Notes\n\nrun ${runId}\n`], 'notes.md'), 'text/markdown'],
        ];
        const out: string[] = [];
        for (const [name, data, want] of cases) {
          expect(contentTypeForPath(name) === want, `contentTypeForPath(${name}) is ${contentTypeForPath(name)}, expected ${want}`);
          let f: StorageFile;
          try {
            f = await storage.upload(config.publicBucket, `${folder}types/${name}`, data);
          } catch (e) {
            if (isTypeNotAllowed(e)) {
              throw new Skip(`${config.publicBucket} doesn't allow ${want}: allow ${name.split('.').pop()!.toUpperCase()} in the Console (Bucket › Settings › Allowed file types) to run this check.`);
            }
            throw e;
          }
          const sent = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());
          keep(`type-${name}`, f, sent);
          expect(f.mimeType === want, `${name} stored as ${f.mimeType}, expected ${want}`);
          out.push(`${name} -> ${f.mimeType}`);
        }
        return out.join('; ');
      },
      needs: (b) => b.publicAllows('application/json', 'text/csv', 'text/markdown'),
    },
    {
      name: 'getFile(id), getFileByPath(bucket, Unicode path)',
      run: async () => {
        const a = await storage.getFile(file('text').id);
        const b = await storage.getFileByPath(config.publicBucket, file('unicode').path);
        expect(a.id === file('text').id && b.id === file('unicode').id, 'wrong file');
        return `${a.path}; ${b.path}`;
      },
    },
    {
      name: 'download(id) - same bytes',
      run: async () => {
        const data = await storage.download(file('unicode').id);
        expect(sameBytes(data, bytes.unicode), 'bytes differ');
        return `${data.byteLength} bytes`;
      },
    },
    {
      name: 'Public link: fetch getUrl(id) with the key -> { url } -> <img>',
      run: async () => {
        const res = await fetch(storage.getUrl(file('png').id), { headers: { 'x-api-key': config.apiKey } });
        const body = await res.json();
        expect(res.ok && body.url, `${res.status} ${body.message ?? ''}`);
        const size = await loadImage(img, body.url);
        expect(size.width === 64 && size.height === 48, `image is ${size.width}x${size.height}`);
        return `${body.url} (${size.width}x${size.height})`;
      },
    },
    {
      name: 'Private file: getUrl(id) -> 403 (no public link)',
      run: async () => {
        const res = await fetch(storage.getUrl(file('private').id), { headers: { 'x-api-key': config.apiKey } });
        expect(res.status === 403, `expected 403, got ${res.status}`);
        return `403 ${(await res.json()).message}`;
      },
    },
    {
      name: 'Private image: download() -> blob URL -> <img>',
      run: async () => {
        const data = await storage.download(file('private').id);
        const url = URL.createObjectURL(new Blob([data], { type: 'image/png' }));
        try {
          const size = await loadImage(img, url);
          expect(size.width === 64, `image is ${size.width} wide`);
          return `${size.width}x${size.height}`;
        } finally {
          URL.revokeObjectURL(url);
        }
      },
    },
    {
      name: 'Private image: signed link from your server -> <img>',
      run: async () => {
        const { url } = await demoServer.signedUrl(file('private').id, 300);
        const size = await loadImage(img, url);
        return `${size.width}x${size.height}, ${url.split('?')[0]}?...`;
      },
    },
    {
      name: 'Wrong way: <img src=getUrl(id)> fails (no headers, and it is JSON)',
      run: async () => {
        try {
          await loadImage(img, storage.getUrl(file('png').id));
        } catch {
          return 'the image did not load, as expected';
        }
        throw new Error('the API address loaded as an image - unexpected');
      },
    },
    {
      name: 'Transforms: every option (fetched with x-api-key + x-user-token)',
      run: async () => {
        const cases: Array<[string, ImageTransforms, ((w: number, h: number) => boolean)?]> = [
          ['width', { width: 32, format: 'png' }, (w, h) => w === 32 && h === 24],
          ['height', { height: 24, format: 'png' }, (w, h) => w === 32 && h === 24],
          ['fit cover', { width: 40, height: 40, fit: 'cover', format: 'png' }, (w, h) => w === 40 && h === 40],
          ['fit contain', { width: 40, height: 40, fit: 'contain', format: 'png' }, (w, h) => w === 40 && h === 40],
          ['fit fill', { width: 40, height: 20, fit: 'fill', format: 'png' }, (w, h) => w === 40 && h === 20],
          ['fit inside', { width: 40, height: 40, fit: 'inside', format: 'png' }, (w, h) => w === 40 && h === 30],
          ['fit outside', { width: 40, height: 40, fit: 'outside', format: 'png' }],
          ['jpeg', { format: 'jpeg' }],
          ['png', { format: 'png' }],
          ['webp', { format: 'webp' }],
          ['avif', { format: 'avif' }],
          ['quality 20', { format: 'jpeg', quality: 20 }],
          ['blur', { blur: 10, format: 'png' }],
          ['sharpen', { sharpen: 50, format: 'png' }],
          ['rotate 90', { rotate: 90, format: 'png' }, (w, h) => w === 48 && h === 64],
        ];
        const out: string[] = [];
        for (const [name, t, check] of cases) {
          const res = await fetch(storage.getTransformUrl(file('private').id, t), { headers: await apiHeaders() });
          if (!res.ok) {
            const r = await TransformRefusal.from(res);
            expect(false, `${name}: ${r.title}: ${r.message} (${r.code ?? `HTTP ${res.status}`})`);
          }
          const blob = await res.blob();
          const type = res.headers.get('content-type') ?? '';
          expect(type.startsWith(`image/${t.format ?? ''}`), `${name}: content type ${type}`);
          let dims = '';
          if (check) {
            const s = await imageSize(blob);
            expect(check(s.width, s.height), `${name}: got ${s.width}x${s.height}`);
            dims = ` ${s.width}x${s.height}`;
          }
          out.push(`${name}: ${type} ${blob.size} B${dims}`);
        }
        return out.join('\n');
      },
    },
    {
      name: 'Public transform link loads without headers (and a second load is a cache hit)',
      run: async () => {
        let url: string;
        try {
          url = await storage.getPublicUrl(file('png').id, { width: 32, format: 'webp' });
        } catch (e) {
          if (e instanceof RiviumStorageException && e.statusCode === 403) {
            throw new Skip(`${config.publicBucket} isn't public (getPublicUrl answered 403): set its Visibility to Public in the Console to run this check.`);
          }
          throw e;
        }
        expect(url.endsWith('?w=32&f=webp'), `unexpected URL ${url}`);
        // The browser fetch, no headers at all (no x-api-key, no user token), past the browser's own cache.
        const load = async (): Promise<Response> => {
          for (let attempt = 1; ; attempt++) {
            let res: Response;
            try {
              res = await fetch(url, { cache: 'no-store' });
            } catch {
              throw new Skip("The browser can't read this answer: public links send no CORS header for this page's origin. The <img> card in section 9 shows the same link; the Node example checks the cache.");
            }
            if (res.ok) return res;
            const r = await TransformRefusal.from(res);
            if (r.code === 'plan_feature_locked') throw new Skip(`${r.message} (403 plan_feature_locked): this check needs a plan with image transforms.`);
            if (r.code === 'transform_busy' && attempt === 1) {
              await sleep((r.retryAfter ?? 2) * 1000);
              continue;
            }
            throw r;
          }
        };
        const describe = async (res: Response) => {
          const type = res.headers.get('content-type') ?? '';
          const blob = await res.blob();
          expect(res.status === 200 && type.startsWith('image/webp'), `HTTP ${res.status}, ${type}`);
          const s = await imageSize(blob);
          expect(s.width === 32 && s.height === 24, `image is ${s.width}x${s.height}`);
          return { cache: res.headers.get('x-transform-cache'), cdn: res.headers.get('cf-cache-status'), bytes: blob.size };
        };
        const first = await describe(await load());
        const second = await describe(await load());
        if (first.cache === null && second.cache === null) {
          return `200 image/webp 32x24 twice (${first.bytes} B), no headers. X-Transform-Cache isn't readable from a browser page; the Node example checks miss / hit.\n${url}`;
        }
        expect(first.cache === 'miss', `first load: X-Transform-Cache ${first.cache}, expected miss`);
        expect(second.cache === 'hit' || second.cdn === 'HIT', `second load: X-Transform-Cache ${second.cache}${second.cdn ? `, CDN ${second.cdn}` : ''}, expected hit`);
        return `first: 200 image/webp, X-Transform-Cache ${first.cache}; second: X-Transform-Cache ${second.cache}${second.cdn ? `, CDN ${second.cdn}` : ''}. No headers sent.\n${url}`;
      },
      needs: (b) => b.publicAllows('image/png'),
    },
    {
      name: 'Signed upload: POST /signed-upload, PUT, POST /confirm-upload',
      run: async () => {
        const data = new TextEncoder().encode(`signed upload ${runId}`);
        const link = await demoServer.signedUpload({ bucket: 'public', contentType: 'text/plain', path: `${folder}signed.txt` });
        let put: Response;
        try {
          put = await fetch(link.url, { method: 'PUT', headers: link.headers, body: data });
        } catch (e) {
          // fetch() rejects (TypeError) only when no answer could be read: in a browser that is CORS on the storage side.
          throw new Skip(
            `The storage bucket doesn't accept browser uploads to signed links yet (CORS). Rivium is enabling it; mobile apps and servers aren't affected. (${(e as Error).message}; origin ${location.origin})`,
          );
        }
        expect(put.ok, `PUT answered ${put.status}`);
        const confirmed = await demoServer.confirmUpload('public', link.path);
        const f = await storage.getFileByPath(config.publicBucket, link.path);
        keep('signed', f, data);
        expect(sameBytes(await storage.download(f.id), data), 'bytes differ');
        return `${f.path} (confirmed id ${String(confirmed.id)})`;
      },
      needs: (b) => b.publicAllows('text/plain'),
    },
    ...ERROR_CASES.map<Check>((c) => ({
      name: `Error: ${c.label}`,
      run: async () => {
        const ctx: ErrorContext = { userId: uid, folder, privateMaxSize: Number(need(buckets, 'the buckets').private.maxFileSize ?? 1048576) };
        const r = await runErrorCase(c, ctx);
        if (r.uploadedId) created.add(r.uploadedId);
        if (!r.ok) throw new Error(r.text);
        return r.text.replace(/^PASS - /, '');
      },
      needs: c.needs,
    })),
    ...(slow
      ? [
          {
            name: 'Slow: token_expired (a 60 s token, wait 65 s)',
            run: async () => {
              const t = await demoServer.token(uid, 60);
              const fixed = new RiviumStorage({ apiKey: config.apiKey, userToken: t.token });
              const withProvider = new RiviumStorage({ apiKey: config.apiKey, tokenProvider });
              await withProvider.setUserToken(t.token);
              await sleep(65_000);
              let code = '';
              try {
                await fixed.listFiles(config.publicBucket, { prefix: folder });
              } catch (e) {
                code = e instanceof RiviumStorageException ? `${e.statusCode} ${e.code}` : describeError(e);
              }
              expect(code === '401 token_expired', `without a provider expected 401 token_expired, got ${code || 'success'}`);
              // With a provider the SDK renews the token before use (or on the 401) and the call goes through.
              const page = await withProvider.listFiles(config.publicBucket, { prefix: folder });
              return `userToken only: ${code}; with tokenProvider: renewed and listed ${page.files.length} file(s)`;
            },
          } as Check,
        ]
      : []),
    {
      name: 'delete(id)',
      run: async () => {
        const id = file('text').id;
        await storage.delete(id);
        created.delete(id);
        try {
          await storage.getFile(id);
        } catch (e) {
          if (e instanceof RiviumStorageException && e.statusCode === 404) return 'deleted; getFile -> 404';
          throw e;
        }
        throw new Error('still there');
      },
    },
    {
      name: 'deleteByPath(bucket, path with spaces)',
      run: async () => {
        const f = file('spaces');
        await storage.deleteByPath(config.publicBucket, f.path);
        created.delete(f.id);
        return f.path;
      },
    },
    {
      name: 'deleteMany(ids)',
      run: async () => {
        const ids = [...created];
        const r = await storage.deleteMany(ids);
        expect(r.deleted === ids.length, `deleted ${r.deleted} of ${ids.length}`);
        created.clear();
        return `deleted ${r.deleted}`;
      },
    },
  ];

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let warned = 0;
  for (const [i, check] of checks.entries()) {
    const li = document.createElement('li');
    li.className = 'run';
    li.innerHTML = '<span class="tag">...</span> ';
    li.append(check.name);
    list.append(li);
    li.scrollIntoView({ block: 'nearest' });
    summary.textContent = `Running ${i + 1} of ${checks.length}: ${check.name}`;
    const t0 = performance.now();
    let detail = '';
    try {
      const unmet = setup && check.needs ? check.needs(setup) : null;
      if (unmet) throw new Skip(unmet);
      detail = (await check.run()) || '';
      li.className = 'pass';
      passed++;
    } catch (e) {
      if (e instanceof Skip) {
        detail = e.message;
        li.className = 'skip';
        skipped++;
      } else if (e instanceof Warn) {
        detail = e.message;
        li.className = 'warn';
        warned++;
      } else {
        detail = describeError(e);
        li.className = 'fail';
        failed++;
      }
    }
    li.querySelector('.tag')!.textContent = { pass: 'PASS', skip: 'SKIP', warn: 'WARN' }[li.className] ?? 'FAIL';
    li.append(` (${Math.round(performance.now() - t0)} ms)`);
    if (detail) li.append(Object.assign(document.createElement('span'), { className: 'detail', textContent: detail }));
  }

  // Cleanup, always, reported.
  let cleanup = 'nothing left to clean up';
  if (created.size) {
    try {
      const r = await storage.deleteMany([...created]);
      cleanup = `cleanup deleted ${r.deleted} of ${created.size} leftover file(s)`;
    } catch (e) {
      cleanup = `cleanup FAILED for ${[...created].join(', ')}: ${describeError(e)}`;
      failed++;
    }
  }
  summary.textContent = `${failed ? `${failed} failed, ` : ''}${passed} of ${checks.length} passed${skipped ? `, ${skipped} skipped` : ''}${warned ? `, ${warned} warning (bucket setup: see the first line)` : ''} - ${cleanup}. (@rivium/storage-web ${SDK_VERSION}, user ${uid})`;
  summary.style.color = failed ? 'var(--err)' : 'var(--ok)';
}
