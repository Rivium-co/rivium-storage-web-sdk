/**
 * The one RiviumStorage instance the page uses, signed in through tokenProvider.
 *
 * tokenProvider asks YOUR server (here the Node example server, POST /token) for a Rivium user token. The SDK calls
 * it before the first request, keeps the token, asks again shortly before it expires, and on a 401 token_expired /
 * token_invalid asks once more and retries the request once. Return null when no one is signed in.
 */
import { RiviumStorage } from '@rivium/storage-web';
import { config } from './config';
import { demoServer, MintedToken } from './demo-server';

export const session = {
  /** Who the demo server mints tokens for. A real app: the user your own sign-in established. */
  userId: config.demoUserId,
  signedIn: true,
  /** The last token the provider returned (kept only to show it and for the few manual fetches below). */
  lastToken: null as MintedToken | null,
  providerCalls: 0,
  /** The SDK logs a provider failure and keeps going without a token; the page shows it instead. */
  lastProviderError: null as string | null,
};

export async function tokenProvider(): Promise<string | null> {
  if (!session.signedIn) return null;
  session.providerCalls++;
  try {
    const minted = await demoServer.token(session.userId);
    session.lastToken = minted;
    session.lastProviderError = null;
    return minted.token;
  } catch (e) {
    session.lastProviderError = (e as Error).message;
    throw e; // the SDK logs it and keeps the previous token (if any); the server then decides
  }
}

/** The SDK refuses an empty key; with a missing key the page shows the setup steps instead of working. */
export const storage = new RiviumStorage({
  apiKey: config.apiKey || 'rv_live_missing_key',
  tokenProvider,
  timeout: 30000,
});

/**
 * Headers for the few addresses the page fetches itself (getUrl / getTransformUrl / getDownloadUrl): those URLs
 * cannot carry headers, so a plain <img src> can't use them. The SDK does not expose its token, so the page uses the
 * one its provider last returned (refreshed when it is about to expire).
 */
export async function apiHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'x-api-key': config.apiKey };
  if (session.signedIn) {
    const t = session.lastToken;
    const expiresSoon = !t || Date.parse(t.expiresAt) - Date.now() < 60_000;
    if (expiresSoon) await storage.refreshUserToken();
    if (session.lastToken) headers['x-user-token'] = session.lastToken.token;
  }
  return headers;
}

/** The claims inside a token (for display; the server verifies the signature, the page does not need to). */
export function decodeToken(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1] || '';
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
    return JSON.parse(json);
  } catch {
    return { error: 'not a JWT' };
  }
}
