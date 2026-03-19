import { RiviumStorage, RiviumStorageException, ImageTransforms } from '@rivium-storage/web';

/// RiviumStorage Web SDK — Complete Example
///
/// This example demonstrates ALL capabilities of the RiviumStorage SDK:
/// - Bucket operations (list, get by ID, get by name)
/// - File operations (upload, list, get, download, delete)
/// - URL generation (public URL, transform URL, download URL)
/// - Image transformations (resize, format, quality, effects)
/// - Error handling
///
/// How it works:
/// - Only the API key and bucket name are configured manually.
/// - All IDs (bucket ID, file IDs, paths) are captured from API responses
///   and reused by subsequent operations — nothing is hardcoded.
/// - Run the buttons top-to-bottom for the best experience.

// ============================================================
// Configuration — only these two values need to be set
// ============================================================

const API_KEY = 'rv_live_YOUR_API_KEY_HERE';
const BUCKET_NAME = 'my-bucket';
const USER_ID = 'demo-user-123';

// ============================================================
// SDK & State
// ============================================================

const storage = new RiviumStorage({ apiKey: API_KEY, userId: USER_ID, timeout: 30000 });

// State captured from API responses — no hardcoded IDs
let lastBucketId: string | null = null;
let lastFileId: string | null = null;
let lastFilePath: string | null = null;
let lastImageFileId: string | null = null;
const uploadedFileIds: string[] = [];

// ============================================================
// Logging
// ============================================================

const logOutput = document.getElementById('log-output')!;
const logCount = document.getElementById('log-count')!;
let entryCount = 0;

function log(message: string, isError = false) {
  entryCount++;
  const line = document.createElement('div');
  line.className = `log-line${isError ? ' error' : ''}`;
  line.textContent = message;
  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
  logCount.textContent = `${entryCount} entries`;
}

function clearLogs() {
  logOutput.innerHTML = '';
  entryCount = 0;
  logCount.textContent = '0 entries';
}

// ============================================================
// Helpers
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

// ============================================================
// Bucket Operations
// ============================================================

async function listBuckets() {
  log('Listing all buckets...');
  try {
    const buckets = await storage.listBuckets();
    log(`Found ${buckets.length} bucket(s):`);
    for (const bucket of buckets) {
      log(`   - ${bucket.name} (${bucket.visibility}) [${bucket.id}]`);
    }
    if (buckets.length > 0) {
      lastBucketId = buckets[0].id;
      log('');
      log(`   Stored bucket ID: ${lastBucketId} for next operations`);
    }
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

async function getBucketById() {
  if (!lastBucketId) {
    log('No bucket ID available. Run "List All Buckets" first.', true);
    return;
  }
  log(`Getting bucket by ID: ${lastBucketId}`);
  try {
    const bucket = await storage.getBucket(lastBucketId);
    log(`Bucket: ${bucket.name}`);
    log(`   - ID: ${bucket.id}`);
    log(`   - Visibility: ${bucket.visibility}`);
    log(`   - Policies Enabled: ${bucket.policiesEnabled}`);
    log(`   - Active: ${bucket.isActive}`);
    if (bucket.allowedMimeTypes) {
      log(`   - Allowed MIME: ${bucket.allowedMimeTypes.join(', ')}`);
    }
    if (bucket.maxFileSize) {
      log(`   - Max File Size: ${formatBytes(bucket.maxFileSize)}`);
    }
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

async function getBucketByName() {
  log(`Getting bucket by name: ${BUCKET_NAME}`);
  try {
    const bucket = await storage.getBucketByName(BUCKET_NAME);
    log(`Found: ${bucket.name} (${bucket.id})`);
    lastBucketId = bucket.id;
    log(`   Stored bucket ID: ${bucket.id}`);
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

// ============================================================
// File Operations
// ============================================================

async function uploadTextFile() {
  if (!lastBucketId) {
    log('No bucket ID available. Run "List All Buckets" or "Get Bucket by Name" first.', true);
    return;
  }
  const content = `Hello, RiviumStorage! Timestamp: ${Date.now()}`;
  const path = `examples/test-${Date.now()}.txt`;

  log(`Uploading text file: ${path}`);
  try {
    const file = await storage.upload(lastBucketId, path, content, {
      contentType: 'text/plain',
      metadata: { author: 'Web Example', version: '1.0' },
    });
    log(`Uploaded: ${file.fileName}`);
    log(`   - ID: ${file.id}`);
    log(`   - Path: ${file.path}`);
    log(`   - Size: ${formatBytes(file.size)}`);
    log(`   - MIME: ${file.mimeType}`);
    if (file.url) log(`   - URL: ${file.url}`);
    lastFileId = file.id;
    lastFilePath = file.path;
    uploadedFileIds.push(file.id);
    log(`   Stored file ID: ${file.id}`);
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

async function uploadImage() {
  if (!lastBucketId) {
    log('No bucket ID available. Run "List All Buckets" or "Get Bucket by Name" first.', true);
    return;
  }
  // 1x1 red PNG
  const redPixelPNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const path = `examples/images/sample-${Date.now()}.png`;

  log(`Uploading image: ${path}`);
  try {
    const file = await storage.upload(lastBucketId, path, redPixelPNG, {
      contentType: 'image/png',
    });
    log(`Uploaded: ${file.fileName}`);
    log(`   - ID: ${file.id}`);
    log(`   - Size: ${formatBytes(file.size)}`);
    lastImageFileId = file.id;
    lastFileId = file.id;
    lastFilePath = file.path;
    uploadedFileIds.push(file.id);
    log(`   Stored image file ID: ${file.id}`);
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

async function listFiles() {
  if (!lastBucketId) {
    log('No bucket ID available. Run "List All Buckets" or "Get Bucket by Name" first.', true);
    return;
  }
  log('Listing files (prefix: examples/, limit: 10)...');
  try {
    const result = await storage.listFiles(lastBucketId, {
      prefix: 'examples/',
      limit: 10,
    });
    log(`Found ${result.files.length} file(s):`);
    for (const file of result.files) {
      log(`   - ${file.path} (${formatBytes(file.size)}) [${file.id}]`);
    }
    if (result.nextCursor) {
      log(`   (More files available, cursor: ${result.nextCursor.substring(0, 20)}...)`);
    }
    if (result.files.length > 0 && !lastFileId) {
      lastFileId = result.files[0].id;
      lastFilePath = result.files[0].path;
      log('');
      log(`   Stored file ID: ${lastFileId} from listing`);
    }
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

async function getFileById() {
  if (!lastFileId) {
    log('No file ID available. Upload a file or run "List Files" first.', true);
    return;
  }
  log(`Getting file by ID: ${lastFileId}`);
  try {
    const file = await storage.getFile(lastFileId);
    log(`Found: ${file.fileName}`);
    log(`   - Path: ${file.path}`);
    log(`   - Size: ${formatBytes(file.size)}`);
    log(`   - MIME: ${file.mimeType}`);
    log(`   - Created: ${file.createdAt}`);
    log(`   - Updated: ${file.updatedAt}`);
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

async function getFileByPath() {
  if (!lastBucketId || !lastFilePath) {
    log('No bucket or file path available. Upload a file first.', true);
    return;
  }
  log(`Getting file by path: ${lastFilePath}`);
  try {
    const file = await storage.getFileByPath(lastBucketId, lastFilePath);
    log(`Found: ${file.fileName} (${file.id})`);
    log(`   - Size: ${formatBytes(file.size)}`);
    log(`   - MIME: ${file.mimeType}`);
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

async function downloadFile() {
  if (!lastFileId) {
    log('No file ID available. Upload a file first.', true);
    return;
  }
  log(`Downloading file: ${lastFileId}`);
  try {
    const data = await storage.download(lastFileId);
    log(`Downloaded ${formatBytes(data.byteLength)}`);
    if (data.byteLength < 200) {
      try {
        const content = new TextDecoder().decode(data);
        log(`   Content: "${content}"`);
      } catch {
        log('   (Binary content)');
      }
    }
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

async function deleteFile() {
  if (!lastFileId) {
    log('No file ID available. Upload a file first.', true);
    return;
  }
  log(`Deleting file: ${lastFileId}`);
  try {
    await storage.delete(lastFileId);
    log('Deleted successfully');
    const idx = uploadedFileIds.indexOf(lastFileId);
    if (idx !== -1) uploadedFileIds.splice(idx, 1);
    lastFileId = uploadedFileIds.length > 0 ? uploadedFileIds[uploadedFileIds.length - 1] : null;
    lastFilePath = null;
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

async function deleteByPath() {
  if (!lastBucketId || !lastFilePath) {
    log('No bucket or file path available. Upload a file first.', true);
    return;
  }
  log(`Deleting file by path: ${lastFilePath}`);
  try {
    await storage.deleteByPath(lastBucketId, lastFilePath);
    log('Deleted successfully');
    if (lastFileId) {
      const idx = uploadedFileIds.indexOf(lastFileId);
      if (idx !== -1) uploadedFileIds.splice(idx, 1);
    }
    lastFileId = uploadedFileIds.length > 0 ? uploadedFileIds[uploadedFileIds.length - 1] : null;
    lastFilePath = null;
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

async function deleteMany() {
  if (uploadedFileIds.length === 0) {
    log('No uploaded file IDs tracked. Upload some files first.', true);
    return;
  }
  const idsToDelete = [...uploadedFileIds];
  log(`Deleting ${idsToDelete.length} file(s): ${idsToDelete.join(', ')}`);
  try {
    const result = await storage.deleteMany(idsToDelete);
    log(`Deleted ${result.deleted} file(s)`);
    uploadedFileIds.length = 0;
    lastFileId = null;
    lastFilePath = null;
    lastImageFileId = null;
  } catch (e) {
    if (e instanceof RiviumStorageException) log(`Error: ${e.message}`, true);
    else log(`Error: ${(e as Error).message}`, true);
  }
}

// ============================================================
// URL Generation
// ============================================================

function generateUrls() {
  if (!lastFileId) {
    log('No file ID available. Upload a file first.', true);
    return;
  }
  const fileId = lastFileId;

  log(`Generating URLs for file: ${fileId}`);
  log('');

  const publicUrl = storage.getUrl(fileId);
  log('Public URL:');
  log(`   ${publicUrl}`);

  const downloadUrl = storage.getDownloadUrl(fileId);
  log('');
  log('Download URL:');
  log(`   ${downloadUrl}`);

  const thumbnailUrl = storage.getTransformUrl(fileId, { width: 200, height: 200 });
  log('');
  log('Thumbnail URL (200x200):');
  log(`   ${thumbnailUrl}`);

  const advancedUrl = storage.getTransformUrl(fileId, {
    width: 800,
    height: 600,
    fit: 'cover',
    format: 'webp',
    quality: 85,
  });
  log('');
  log('Advanced Transform URL:');
  log(`   ${advancedUrl}`);
}

// ============================================================
// Image Transformations
// ============================================================

function showTransforms() {
  const fileId = lastImageFileId ?? lastFileId;
  if (!fileId) {
    log('No file ID available. Upload an image first.', true);
    return;
  }

  log(`Image Transform Examples (file: ${fileId}):`);
  log('='.repeat(50));

  const transforms: Record<string, ImageTransforms> = {
    'Resize 200x200': { width: 200, height: 200 },
    'Width only (auto height)': { width: 400 },
    'Height only (auto width)': { height: 300 },
    'Fit: cover': { width: 200, height: 200, fit: 'cover' },
    'Fit: contain': { width: 200, height: 200, fit: 'contain' },
    'Fit: fill': { width: 200, height: 200, fit: 'fill' },
    'Format: WebP': { width: 200, format: 'webp' },
    'Format: AVIF': { width: 200, format: 'avif' },
    'Format: JPEG': { width: 200, format: 'jpeg' },
    'Quality: 50%': { width: 200, format: 'jpeg', quality: 50 },
    'Quality: 90%': { width: 200, format: 'jpeg', quality: 90 },
    'Blur effect': { width: 200, blur: 10 },
    'Sharpen effect': { width: 200, sharpen: 50 },
    'Rotate 90deg': { rotate: 90 },
    'Rotate 180deg': { rotate: 180 },
    'Rotate 270deg': { rotate: 270 },
    'Combined transforms': {
      width: 400,
      height: 300,
      fit: 'cover',
      format: 'webp',
      quality: 80,
      sharpen: 20,
    },
  };

  for (const [name, opts] of Object.entries(transforms)) {
    const url = storage.getTransformUrl(fileId, opts);
    log('');
    log(`${name}:`);
    log(`   ${url}`);
  }
}

// ============================================================
// Policy Testing Helpers
// ============================================================

async function ensureBucket(): Promise<string | null> {
  if (lastBucketId) return lastBucketId;
  log('No bucket. Running "List All Buckets" first...');
  await listBuckets();
  if (!lastBucketId) log('No bucket available. Create one in the dashboard first.', true);
  return lastBucketId;
}

function textData(): string {
  return `Hello, RiviumStorage! Timestamp: ${Date.now()}`;
}

function pngData(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

async function tryUpload(bucketId: string, path: string, data: string | Uint8Array, contentType?: string): Promise<string> {
  try {
    await storage.upload(bucketId, path, data, { contentType: contentType || 'text/plain' });
    return 'ALLOWED';
  } catch {
    return 'DENIED';
  }
}

async function tryList(bucketId: string): Promise<string> {
  try {
    await storage.listFiles(bucketId, { limit: 1 });
    return 'ALLOWED';
  } catch {
    return 'DENIED';
  }
}

// ============================================================
// Policy Testing
// ============================================================

async function testNoRules() {
  const bucketId = await ensureBucket();
  if (!bucketId) return;

  log('');
  log('='.repeat(40));
  log('  TEST: No Rules (no policy on bucket)');
  log('  Dashboard: Delete the policy from bucket');
  log('  When no policy exists, all access is allowed');
  log('='.repeat(40));
  log('');
  log(`Current userId: ${storage.userId ?? 'none (unauthenticated)'}`);
  log('');

  const ts = Date.now();
  log(`Upload text file:   ${await tryUpload(bucketId, `test/no-rules-${ts}.txt`, textData())}`);
  log(`Upload image:       ${await tryUpload(bucketId, `test/no-rules-${ts}.png`, pngData(), 'image/png')}`);
  log(`List files:         ${await tryList(bucketId)}`);
  log('');
  log('Expected: Everything ALLOWED (no policy = no restrictions)');
}

async function testPrivate() {
  const bucketId = await ensureBucket();
  if (!bucketId) return;

  log('');
  log('='.repeat(40));
  log('  TEST: Private Template');
  log('  Dashboard: Apply "Private" template');
  log('  Rule: Allow only authenticated users');
  log('  (default-deny: unauthenticated = denied)');
  log('='.repeat(40));
  log('');

  const ts = Date.now();

  // Test WITH userId
  log(`-- With userId: ${storage.userId} --`);
  log(`Upload text:   ${await tryUpload(bucketId, `test/private-${ts}.txt`, textData())}`);
  log(`Upload image:  ${await tryUpload(bucketId, `test/private-${ts}.png`, pngData(), 'image/png')}`);
  log(`List files:    ${await tryList(bucketId)}`);
  log('');

  // Test WITHOUT userId
  const savedUserId = storage.userId;
  storage.setUserId(null);
  log('-- Without userId (unauthenticated) --');
  log(`Upload text:   ${await tryUpload(bucketId, `test/private-anon-${ts}.txt`, textData())}`);
  log(`List files:    ${await tryList(bucketId)}`);
  storage.setUserId(savedUserId);

  log('');
  log('Expected:');
  log('  With userId:    Everything ALLOWED');
  log('  Without userId: Everything DENIED');
}

async function testPublicRead() {
  const bucketId = await ensureBucket();
  if (!bucketId) return;

  log('');
  log('='.repeat(40));
  log('  TEST: Public Read Template');
  log('  Dashboard: Apply "Public Read" template');
  log('  Rule: Anyone can read/list,');
  log('        auth required to write/delete');
  log('='.repeat(40));
  log('');

  const ts = Date.now();

  // Test WITH userId
  log(`-- With userId: ${storage.userId} --`);
  log(`Upload text:   ${await tryUpload(bucketId, `test/public-${ts}.txt`, textData())}`);
  log(`List files:    ${await tryList(bucketId)}`);
  log('');

  // Test WITHOUT userId
  const savedUserId = storage.userId;
  storage.setUserId(null);
  log('-- Without userId (unauthenticated) --');
  log(`List files:    ${await tryList(bucketId)}`);
  log(`Upload text:   ${await tryUpload(bucketId, `test/public-anon-${ts}.txt`, textData())}`);
  storage.setUserId(savedUserId);

  log('');
  log('Expected:');
  log('  With userId:    Upload ALLOWED, List ALLOWED');
  log('  Without userId: List ALLOWED, Upload DENIED');
}

async function testUserFolders() {
  const bucketId = await ensureBucket();
  if (!bucketId) return;

  log('');
  log('='.repeat(40));
  log('  TEST: User Folders Template');
  log('  Dashboard: Apply "User Folders" template');
  log('  Rule: Auth users can read/list all,');
  log('        write/delete only in users/{userId}/');
  log('='.repeat(40));
  log('');

  const uid = storage.userId ?? 'demo-user-123';
  const ts = Date.now();

  log(`-- With userId: ${uid} --`);
  log('');
  log(`Upload to own folder (users/${uid}/):`);
  log(`  users/${uid}/photo.txt:        ${await tryUpload(bucketId, `users/${uid}/photo-${ts}.txt`, textData())}`);
  log(`  users/${uid}/sub/doc.txt:      ${await tryUpload(bucketId, `users/${uid}/sub/doc-${ts}.txt`, textData())}`);
  log('');
  log('Upload to OTHER user folder:');
  log(`  users/other-user/hack.txt:   ${await tryUpload(bucketId, `users/other-user/hack-${ts}.txt`, textData())}`);
  log('');
  log('Upload to root (no user folder):');
  log(`  test/random.txt:             ${await tryUpload(bucketId, `test/random-${ts}.txt`, textData())}`);
  log('');
  log(`List files:                    ${await tryList(bucketId)}`);

  // Test without userId
  const savedUserId = storage.userId;
  storage.setUserId(null);
  log('');
  log('-- Without userId (unauthenticated) --');
  log(`Upload:   ${await tryUpload(bucketId, `users/anon/test-${ts}.txt`, textData())}`);
  log(`List:     ${await tryList(bucketId)}`);
  storage.setUserId(savedUserId);

  log('');
  log('Expected:');
  log('  Own folder:     ALLOWED');
  log('  Other folder:   DENIED');
  log('  Root path:      DENIED');
  log('  List:           ALLOWED');
  log('  No userId:      DENIED (all)');
}

async function testImagesOnly() {
  const bucketId = await ensureBucket();
  if (!bucketId) return;

  log('');
  log('='.repeat(40));
  log('  TEST: Images Only Template');
  log('  Dashboard: Apply "Images Only" template');
  log('  Rule: Anyone can read/list/delete,');
  log('        only auth users can upload images');
  log('        (JPEG/PNG/GIF/WebP, 5MB max)');
  log('='.repeat(40));
  log('');

  const ts = Date.now();

  log(`-- With userId: ${storage.userId} --`);
  log('');
  log(`Upload PNG image:        ${await tryUpload(bucketId, `test/image-${ts}.png`, pngData(), 'image/png')}`);
  log(`Upload text file:        ${await tryUpload(bucketId, `test/doc-${ts}.txt`, textData(), 'text/plain')}`);
  log(`Upload PDF:              ${await tryUpload(bucketId, `test/doc-${ts}.pdf`, textData(), 'application/pdf')}`);
  log(`List files:              ${await tryList(bucketId)}`);

  // Test without userId
  const savedUserId = storage.userId;
  storage.setUserId(null);
  log('');
  log('-- Without userId (unauthenticated) --');
  log(`Upload PNG:   ${await tryUpload(bucketId, `test/anon-${ts}.png`, pngData(), 'image/png')}`);
  log(`Upload text:  ${await tryUpload(bucketId, `test/anon-${ts}.txt`, textData())}`);
  log(`List files:   ${await tryList(bucketId)}`);
  storage.setUserId(savedUserId);

  log('');
  log('Expected:');
  log('  PNG image:      ALLOWED');
  log('  Text file:      DENIED (not an image)');
  log('  PDF file:       DENIED (not an image)');
  log('  List:           ALLOWED (read is open)');
  log('  No userId PNG:  DENIED (auth required for upload)');
  log('  No userId List: ALLOWED (read is open)');
}

// ============================================================
// Error Handling
// ============================================================

async function demonstrateErrorHandling() {
  log('Testing error handling with invalid file ID...');
  try {
    await storage.getFile('non-existent-file-id');
  } catch (e) {
    if (e instanceof RiviumStorageException) {
      log('');
      log('Caught RiviumStorageException:');
      log(`   Message: ${e.message}`);
      if (e.statusCode) log(`   Status Code: ${e.statusCode}`);
      if (e.code) log(`   Error Code: ${e.code}`);
      log('');
      log('Error handling example complete!');
    }
  }
}

// ============================================================
// Wire up buttons
// ============================================================

const actions: Record<string, () => void | Promise<void>> = {
  listBuckets,
  getBucketById,
  getBucketByName,
  uploadTextFile,
  uploadImage,
  listFiles,
  getFileById,
  getFileByPath,
  downloadFile,
  deleteFile,
  deleteByPath,
  deleteMany,
  generateUrls,
  showTransforms,
  testNoRules,
  testPrivate,
  testPublicRead,
  testUserFolders,
  testImagesOnly,
  demonstrateErrorHandling,
};

document.getElementById('clear-btn')!.addEventListener('click', clearLogs);

document.getElementById('buttons')!.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const action = target.dataset.action;
  if (action && actions[action]) {
    actions[action]();
  }
});
