# Rivium Storage - Web example

One page (Vite + TypeScript) that runs every feature of `@rivium/storage-web` against the real service, shows each
result or the exact error, and has a **Run all checks** self-test with PASS / FAIL per step and cleanup.

It uses the SDK source in `../` (`"@rivium/storage-web": "file:../"`, loaded from `../src` by Vite and by
TypeScript), never the published package, so SDK changes show up on reload without building the SDK.

## Setup

The page only has the **public key**. User tokens, signed links and the test buckets come from "your server": the
Node example server in `sdk/nodejs/Example`, which holds the server secret.

```bash
# 1. Start the example server (once per session) - see sdk/nodejs/Example/README.md
cd sdk/nodejs && npm install && npm run build
cd Example && cp .env.example .env    # put RIVIUM_API_KEY + RIVIUM_SERVER_SECRET in it
npm install && npm run server         # http://127.0.0.1:4000

# 2. This page
cd sdk/web/Example
cp .env.example .env.local            # git-ignored; public values only
#    VITE_RIVIUM_API_KEY=rv_live_...   (the public key - NEVER the server secret)
npm install
npm run dev                           # http://localhost:5173
```

Then on the page: **1. Setup > Prepare the test buckets** (or `npm run setup-buckets` in the Node example), and
**11. Run all checks**.

**Bucket setup** runs first: it reads both test buckets with the SDK and compares them with what the checks expect (public bucket: public, allows PNG, PDF, TXT, JSON, CSV and Markdown, where no allowed types means any; private bucket: private, images only, max 1 MB; both: Block executable files on), which is exactly what `npm run setup-buckets` in `sdk/nodejs/Example` creates. When they match it passes; otherwise it shows **WARN** with each difference and the Console setting to change (`Console › Storage › Buckets › <name> › Settings › …`), and every check that needs that setting (type not allowed, too big, `executable_blocked`, content mismatch, upload progress, file types, the PDF / text uploads) is skipped with the same hint instead of failing. A field an older Storage API doesn't send (`blockExecutables`) counts as unknown, not wrong. Against an older Storage API that refuses without an error `code`, the error checks accept the 400 with the known message and add "server sent no code (older Storage API)". The signed upload's browser PUT is skipped (not failed) when the storage bucket doesn't accept browser uploads to signed links yet (CORS); mobile apps and servers aren't affected.

Also check:
- Rivium Storage is on for the project (Console > Project settings > Products > Rivium Storage).
- If the project limits browser origins, add `http://localhost:5173` to its allowed origins, or the browser blocks
  the Storage API.
- The Node server's `CORS_ORIGINS` includes `http://localhost:5173` (it does by default).
- Signed uploads PUT straight to the storage bucket from the browser; if that PUT is blocked, the storage bucket's
  CORS does not allow this origin yet (Run all checks shows SKIP, not FAIL).

### `.env.local`

| Variable | Default | |
| --- | --- | --- |
| `VITE_RIVIUM_API_KEY` | - | public key `rv_live_...` (required) |
| `VITE_EXAMPLE_SERVER_URL` | `http://localhost:4000` | the Node example server |
| `VITE_DEMO_TOKEN` | (empty) | only when the Node example server has `DEMO_TOKEN` set: the same value, sent as `x-demo-token` |
| `VITE_PUBLIC_BUCKET` | `rivium-example-public` | same as the server's `PUBLIC_BUCKET` |
| `VITE_PRIVATE_BUCKET` | `rivium-example-private-images` | same as the server's `PRIVATE_BUCKET` |
| `VITE_DEMO_USER_ID` | `demo-user-web` | the user the page signs in as |

## Commands

| Command | |
| --- | --- |
| `npm run dev` | dev server on port 5173 |
| `npm run typecheck` | `tsc --noEmit` (against `../src`) |
| `npm run build` | type-check + production build into `dist/` |
| `npm run preview` | serve the build on port 4173 |

## What the page covers

| Section | SDK |
| --- | --- |
| 2. Sign in | `tokenProvider` (via `POST /token`), `refreshUserToken()` (sign in, switch user, sign out), `setUserToken()`, option `userToken`, the live `isAwaitingUserToken` state; a note on using Rivium Auth instead (`tokenProvider: () => auth.getToken()`) |
| 3. Waiting for sign-in | sign out, then `listFiles()` waits (`isAwaitingUserToken`, `onAwaitingUserToken`); sign in and it completes |
| 4. Buckets | `listBuckets()`, `getBucket(id)`, `getBucketByName(name)` |
| 5. Upload | file picker + drag and drop, `File` / `Blob` / `Uint8Array` / `string`, `contentType`, `metadata`, `onProgress` (progress bar, ~5 MB generated PNG of noise pixels), `رسید-۸۸۱۲.pdf`, `my holiday photo.png` |
| 6. Files | `listFiles()` with `prefix` / `limit` / cursor paging, `getFile()`, `getFileByPath()`, `download()`, `delete()`, `deleteByPath()`, `deleteMany()` |
| 7. Show images | public link, `download()` + blob URL, signed link - and why `<img src={getUrl(id)}>` fails |
| 8. Links | `getUrl()` -> public link, `getDownloadUrl()`, signed download link (opens), signed upload (server link + PUT + confirm) |
| 9. Transforms | `getTransformUrl()` with width, height, fit, format, quality, blur, sharpen, rotate; fetched with headers, result shown |
| 10. Errors | not found, bad id, `type_not_allowed`, `file_too_large`, denied by rules, `executable_blocked`, content mismatch, `token_required` (no user within `userTokenWaitTimeout`), `server_secret_required` (an admin action from the app), `token_invalid`, `TIMEOUT` (each matched by the error's `code`, `StorageErrorCode`) |
| 11. Run all checks | all of the above in order (including "calls wait until sign-in" (sign out -> `listFiles()` waits -> sign in -> it completes), "upload progress reaches 100%" and "file types: .json / .csv / .md upload with no contentType") + optional `token_expired` and token auto-renewal (about 70 s) |

### Showing an image: the right way

An `<img src>` sends no headers. `getUrl()`, `getDownloadUrl()` and `getTransformUrl()` are API addresses that need
`x-api-key` (and the user token), and `getUrl()` answers JSON `{ url }`, not the image - so none of them goes into
an `<img>`.

- Public bucket: fetch `getUrl(id)` with the key and use the `url` it returns.
- Private bucket: `download(id)` and show a blob URL, or ask your server for a signed link.
- Transforms: fetch `getTransformUrl()` with the headers and show the blob.

## SDK gaps found while writing this (not changed in the SDK)

- No way to fetch a transform or a download URL with the SDK's headers: the page fetches them itself and needs the
  user token, which the SDK does not expose (the page keeps the one its `tokenProvider` returned). (The public link
  now has `getPublicUrl()`; the page still shows the raw `getUrl()` request to explain it.)
- No signed links (server-only by design) and no confirm for signed uploads in this SDK; the page uses the Node
  example server.
- `ImageTransforms.fit` / `format` are plain `string`s (the Node SDK has the exact unions); the SDK checks the values
  at runtime (`invalid_transform`).
- A failing `tokenProvider` is only logged to the console by the SDK; a file call then waits for a token like when nobody is signed in.
