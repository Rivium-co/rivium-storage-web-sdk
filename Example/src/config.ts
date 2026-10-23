/**
 * Settings from .env.local (git-ignored; see .env.example). Only public values: the public key, the address of the
 * Node example server, bucket names, a demo user id. The server secret never comes near the browser.
 */
const env = import.meta.env;

export const config = {
  apiKey: String(env.VITE_RIVIUM_API_KEY ?? '').trim(),
  serverUrl: String(env.VITE_EXAMPLE_SERVER_URL ?? 'http://localhost:4000').replace(/\/+$/, ''),
  publicBucket: String(env.VITE_PUBLIC_BUCKET ?? 'rivium-example-public'),
  privateBucket: String(env.VITE_PRIVATE_BUCKET ?? 'rivium-example-private-images'),
  demoUserId: String(env.VITE_DEMO_USER_ID ?? 'demo-user-web'),
  /** Sent as `x-demo-token` when the Node example server has DEMO_TOKEN set. */
  demoToken: String(env.VITE_DEMO_TOKEN ?? '').trim(),
};

/** What is wrong with the settings, as steps to fix it (empty = fine). */
export function configProblems(): string[] {
  const problems: string[] = [];
  if (!config.apiKey || /YOUR_/.test(config.apiKey)) {
    problems.push('VITE_RIVIUM_API_KEY is not set. Copy .env.example to .env.local and put your public key (rv_live_...) in it, then restart npm run dev.');
  } else if (!/^rv_(live|test)_/.test(config.apiKey)) {
    problems.push('VITE_RIVIUM_API_KEY should be the public key (rv_live_... or rv_test_...).');
  }
  if (/^rv_srv_/.test(config.apiKey)) {
    problems.push('That is the SERVER SECRET. Never put it in browser code: rotate it in the Console and use the public key here.');
  }
  return problems;
}

/** The Storage API address (built into the SDK; the page needs it only to explain URLs). */
export const STORAGE_API = 'https://storage.rivium.co';
