/**
 * Each typed error, triggered on purpose. Used by the Errors section and by "Run all checks".
 */
import { RiviumStorage, RiviumStorageException, StorageErrorCode } from '@rivium/storage-web';
import { config, STORAGE_API } from './config';
import { storage, tokenProvider, apiHeaders } from './storage';
import { makePdf, makeBlob, makeFakeExe, makeHtml } from './samples';
import { describeError } from './ui';
import { BucketSetup, legacyMatch, LEGACY_NOTE } from './bucket-setup';

export interface ErrorContext {
  userId: string;
  /** A folder unique to this run, inside the user's own folder: users/{userId}/web-example/<run>/ */
  folder: string;
  privateMaxSize: number;
}

export interface Expected {
  status: number[];
  /** Allowed codes; null = no code. Omitted = any. */
  code?: (string | null)[];
  message?: RegExp;
}

export interface ErrorCase {
  id: string;
  label: string;
  explain: string;
  expect: Expected;
  run: (ctx: ErrorContext) => Promise<unknown>;
  /** The bucket setting this case needs (from the "Bucket setup" check): a string = SKIP with that hint. */
  needs?: (setup: BucketSetup) => string | null;
}

const ZERO_ID = '00000000-0000-4000-8000-000000000000';

export const ERROR_CASES: ErrorCase[] = [
  {
    id: 'not-found',
    label: 'Not found',
    explain: 'getFile() with an id that does not exist: 404.',
    expect: { status: [404], message: /not found/i },
    run: () => storage.getFile(ZERO_ID),
  },
  {
    id: 'bad-id',
    label: 'Bad id',
    explain: 'getFile("not-a-uuid"): 400 "Invalid file ID format".',
    expect: { status: [400], message: /Invalid file ID/i },
    run: () => storage.getFile('not-a-uuid'),
  },
  {
    id: 'type',
    label: 'Type not allowed',
    explain: 'A PDF in the images-only private bucket: 400, code type_not_allowed (StorageErrorCode.TypeNotAllowed).',
    expect: { status: [400], code: [StorageErrorCode.TypeNotAllowed] },
    run: (c) => storage.upload(config.privateBucket, `${c.folder}not-an-image.pdf`, makePdf(), { contentType: 'application/pdf' }),
    needs: (b) => b.privateRefuses('application/pdf'),
  },
  {
    id: 'too-big',
    label: 'Too big',
    explain: 'One byte over the private bucket\'s size limit: 400, code file_too_large (StorageErrorCode.FileTooLarge).',
    expect: { status: [400], code: [StorageErrorCode.FileTooLarge] },
    run: (c) => storage.upload(config.privateBucket, `${c.folder}too-big.png`, makeBlob(c.privateMaxSize + 1), { contentType: 'image/png' }),
    needs: (b) => b.privateHasMaxSize(),
  },
  {
    id: 'rules',
    label: 'Denied by the rules',
    explain: "Writing into another user's folder: the rule set \"Users' own folders\" refuses it with 403.",
    expect: { status: [403] },
    run: (c) => storage.upload(config.publicBucket, `users/someone-else-than-${c.userId}/hello.txt`, 'not yours', { contentType: 'text/plain' }),
  },
  {
    id: 'executable',
    label: 'Executable blocked',
    explain: 'A tiny fake setup.exe ("MZ" header): 400, code executable_blocked (StorageErrorCode.ExecutableBlocked).',
    expect: { status: [400], code: [StorageErrorCode.ExecutableBlocked] },
    run: (c) => storage.upload(config.publicBucket, `${c.folder}setup.exe`, makeFakeExe(), { contentType: 'application/octet-stream' }),
    needs: (b) => b.blocksExecutables('public'),
  },
  {
    id: 'mismatch',
    label: 'Content mismatch',
    explain: 'HTML bytes declared as image/png: the server checks the real content and refuses text/html in an images-only bucket (code type_not_allowed).',
    expect: { status: [400], code: [StorageErrorCode.TypeNotAllowed], message: /text\/html/ },
    run: (c) => storage.upload(config.privateBucket, `${c.folder}fake.png`, makeHtml(), { contentType: 'image/png' }),
    needs: (b) => b.privateRefuses('text/html'),
  },
  {
    id: 'no-user',
    label: 'No user in time (token_required)',
    explain: 'File calls need a signed-in user: with no token they wait (nothing is sent). An instance with no token and userTokenWaitTimeout: 1500 gives up after 1.5 s: 401, code token_required (StorageErrorCode.TokenRequired). Without the option the call would wait until a user signs in.',
    expect: { status: [401], code: [StorageErrorCode.TokenRequired] },
    run: () => new RiviumStorage({ apiKey: config.apiKey, userTokenWaitTimeout: 1500 }).listFiles(config.privateBucket),
  },
  {
    id: 'admin',
    label: 'Admin action from an app (server_secret_required)',
    explain: 'Creating a bucket (like changing buckets, rules or visibility, or making signed links) is for your server: with the public key (and a user token) the API answers 403, code server_secret_required. The Web SDK has no such calls; this card sends POST /api/v1/buckets itself.',
    expect: { status: [403], code: [StorageErrorCode.ServerSecretRequired] },
    run: async () => {
      const res = await fetch(`${STORAGE_API}/api/v1/buckets`, {
        method: 'POST',
        headers: { ...(await apiHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `web-example-not-allowed-${Date.now()}` }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: unknown; code?: unknown };
      if (res.ok) return body;
      throw new RiviumStorageException(
        typeof body.message === 'string' ? body.message : `HTTP ${res.status}`,
        res.status,
        typeof body.code === 'string' ? body.code : undefined,
      );
    },
  },
  {
    id: 'token-invalid',
    label: 'token_invalid',
    explain: 'A token that is not a valid Rivium user token (option userToken, no provider, so no retry): 401 token_invalid.',
    expect: { status: [401], code: [StorageErrorCode.TokenInvalid] },
    run: () => new RiviumStorage({ apiKey: config.apiKey, userToken: 'not.a.valid-token' }).listFiles(config.publicBucket),
  },
  {
    id: 'timeout',
    label: 'Timeout',
    explain: 'timeout: 1 ms: 408, code TIMEOUT.',
    expect: { status: [408], code: ['TIMEOUT'] },
    run: () => new RiviumStorage({ apiKey: config.apiKey, tokenProvider, timeout: 1 }).listBuckets(),
  },
];

/**
 * True when the error has no code but is what an OLDER Storage API answers for an expected code (status 400 and the
 * known message): it refused correctly, it just doesn't send codes yet.
 */
export function isLegacyRefusal(expected: Expected, e: unknown): boolean {
  if (!(e instanceof RiviumStorageException) || !expected.code) return false;
  return expected.code.some((c) => !!c && legacyMatch(c, e.statusCode, e.code, e.message));
}

/** Compares an error with what was expected. Returns null when it matches, else what differs. */
export function mismatch(expected: Expected, e: unknown): string | null {
  if (!(e instanceof RiviumStorageException)) return `expected a RiviumStorageException, got ${describeError(e)}`;
  if (!expected.status.includes(e.statusCode ?? -1)) return `expected status ${expected.status.join(' or ')}`;
  if (expected.code && !expected.code.includes(e.code ?? null) && !isLegacyRefusal(expected, e)) {
    return `expected code ${expected.code.map((c) => c ?? '(none)').join(' or ')}`;
  }
  if (expected.message && !expected.message.test(e.message)) return `expected the message to match ${expected.message}`;
  return null;
}

/** Runs one case. ok = it failed exactly as expected. `uploadedId` = it unexpectedly stored a file (clean it up). */
export async function runErrorCase(c: ErrorCase, ctx: ErrorContext): Promise<{ ok: boolean; text: string; uploadedId?: string }> {
  try {
    const value = await c.run(ctx);
    const id = value && typeof value === 'object' && 'id' in value ? String((value as { id: unknown }).id) : undefined;
    return { ok: false, text: `FAIL - expected an error, but it succeeded:\n${JSON.stringify(value, null, 2)}`, uploadedId: id };
  } catch (e) {
    const problem = mismatch(c.expect, e);
    return problem
      ? { ok: false, text: `FAIL - ${problem}; got:\n${describeError(e)}` }
      : { ok: true, text: `PASS - refused as expected${isLegacyRefusal(c.expect, e) && !(e as RiviumStorageException).code ? ` (${LEGACY_NOTE})` : ''}:\n${describeError(e)}` };
  }
}
