/**
 * Calls to "your server" - here the Node example server (sdk/nodejs/Example, npm run server).
 * It holds the server secret; this page only ever receives user tokens and signed links from it.
 */
import { config } from './config';

export class DemoServerError extends Error {
  constructor(message: string, public status?: number, public code?: string | null) {
    super(message);
    this.name = 'DemoServerError';
  }
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.demoToken ? { 'x-demo-token': config.demoToken } : {}) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new DemoServerError(
      `Cannot reach the example server at ${config.serverUrl} (${(e as Error).message}). Start it: cd sdk/nodejs/Example && npm run server. ` +
        `If it runs, check that CORS_ORIGINS in its .env includes ${location.origin}.`,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new DemoServerError(data.error || `HTTP ${res.status}`, res.status, data.code);
  return data as T;
}

export interface MintedToken {
  token: string;
  userId: string;
  expiresIn: number;
  expiresAt: string;
}

export interface TestBucket {
  id: string;
  name: string;
  visibility: string;
  allowedMimeTypes: string[] | null;
  maxFileSize: number | null;
  blockExecutables: boolean | null;
  created: boolean;
  rulesApplied: boolean;
}

export interface TestBuckets {
  public: TestBucket;
  private: TestBucket;
  warnings: string[];
}

export interface SignedUpload {
  url: string;
  uploadId?: string;
  path: string;
  expiresAt?: string;
  maxSize?: number;
  bucket: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export const demoServer = {
  async health(): Promise<unknown> {
    try {
      const res = await fetch(`${config.serverUrl}/health`);
      return await res.json();
    } catch (e) {
      throw new DemoServerError(`Cannot reach the example server at ${config.serverUrl} (${(e as Error).message}). Start it: cd sdk/nodejs/Example && npm run server`);
    }
  },
  /** POST /token - what tokenProvider calls. A real app's server uses ITS signed-in user, not an id from the request. */
  token: (userId: string, expiresIn?: number) => post<MintedToken>('/token', { userId, expiresIn }),
  setupTestBuckets: () => post<TestBuckets>('/setup-test-buckets'),
  signedUpload: (body: { bucket: 'public' | 'private'; contentType: string; userId?: string; fileName?: string; path?: string }) =>
    post<SignedUpload>('/signed-upload', body),
  confirmUpload: (bucket: 'public' | 'private', path: string) => post<Record<string, unknown>>('/confirm-upload', { bucket, path }),
  signedUrl: (fileId: string, expiresIn = 600) => post<{ url: string; expiresIn: number }>('/signed-url', { fileId, expiresIn }),
};
