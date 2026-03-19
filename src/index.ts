/// RiviumStorage Web SDK
///
/// Official Web SDK for RiviumStorage file storage and image transformation service.
///
/// ## Getting Started
///
/// ```ts
/// import { RiviumStorage } from '@rivium-storage/web';
///
/// const storage = new RiviumStorage({ apiKey: 'rv_live_xxx' });
///
/// // Upload a file
/// const file = await storage.upload(
///   'my-bucket',
///   'images/photo.jpg',
///   fileBlob,
///   { contentType: 'image/jpeg' },
/// );
///
/// // Get transformed URL
/// const thumbnailUrl = storage.getTransformUrl(file.id, { width: 200, height: 200 });
/// ```

export { RiviumStorage } from './rivium-storage';
export { RiviumStorageException } from './models';
export type {
  RiviumStorageConfig,
  Bucket,
  StorageFile,
  ListFilesResult,
  DeleteManyResult,
  UploadOptions,
  ListFilesOptions,
  ImageTransforms,
} from './models';
