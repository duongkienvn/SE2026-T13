import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { fetch as expoFetch } from 'expo/fetch';
import { createNativeMultipartUpload } from '../../infrastructure/api/native-upload';
import { ApiError } from '../../infrastructure/api/errors';
import {
  avatarDeclaration,
  inspectAvatar,
  MAX_AVATAR_BYTES,
  MAX_PRIVATE_AVATAR_BYTES,
  type AvatarTransferPorts,
  type Photo,
} from './avatar';

const root = new Directory(Paths.cache, 'kanvexa-private-avatars');
let storageFailed = false;
export function clearPrivateAvatarFiles() {
  try {
    if (root.exists) root.delete();
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
}
function save(bytes: Uint8Array, name: string) {
  if (storageFailed)
    throw new ApiError('http', {
      code: 'PRIVATE_STORAGE_FAILED',
      requestStarted: false,
    });
  root.create({ intermediates: true, idempotent: true });
  const directory = new Directory(root, randomUUID());
  directory.create();
  const dispose = () => {
    try {
      if (directory.exists) directory.delete();
    } catch {
      storageFailed = true;
    }
  };
  try {
    const file = new File(directory, name);
    file.create();
    file.writeSync(bytes);
    return { uri: file.uri, dispose };
  } catch {
    dispose();
    throw new ApiError('http', {
      code: 'PRIVATE_STORAGE_FAILED',
      requestStarted: false,
    });
  }
}
export function savePrivateAvatar(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_PRIVATE_AVATAR_BYTES)
    throw new ApiError('invalid-response');
  return save(bytes, 'avatar.webp');
}
function isPickerCacheCopy(uri: string) {
  // Paths.cache is trusted native state and may contain Expo Go's encoded
  // experience name. Check the directory boundary before inspecting the suffix.
  const prefix = Paths.cache.uri.replace(/\/+$/, '') + '/';
  if (!uri.startsWith(prefix)) return false;
  const relative = uri.slice(prefix.length);
  return (
    !/[\\%?#\p{Cc}]/u.test(relative) &&
    relative.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}
/** Modern system photo picker grants only the selected file; no startup/broad library permission. */
export async function selectPrivatePhoto(
  check: () => void,
  signal: AbortSignal,
): Promise<Photo | null> {
  check();
  let result;
  try {
    result = await launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: false,
      quality: 1,
      base64: false,
      exif: false,
    });
  } catch {
    check();
    throw new ApiError('http', {
      code: 'PHOTO_PICKER_UNAVAILABLE',
      requestStarted: false,
    });
  }
  if (result.canceled) {
    check();
    return null;
  }
  const asset = result.assets[0];
  if (!asset) {
    check();
    return null;
  }
  if (!/^(file:\/\/|content:\/\/)/.test(asset.uri))
    throw new ApiError('invalid-response', { requestStarted: false });
  const source = new File(asset.uri);
  try {
    check();
    const declaration = avatarDeclaration(
      asset.mimeType ?? source.type,
      source.size,
    );
    if (
      (asset.fileSize !== undefined &&
        asset.fileSize !== declaration.fileSize) ||
      (asset.width && asset.height && asset.width * asset.height > 16_000_000)
    )
      throw new ApiError('http', {
        status: 422,
        code: 'AVATAR_INVALID_IMAGE',
        requestStarted: false,
      });
    const reader = source.readableStream().getReader();
    const abort = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const bytes = new Uint8Array(declaration.fileSize);
    let received = 0;
    try {
      for (;;) {
        check();
        const { done, value } = await reader.read();
        check();
        if (done) break;
        received += value.byteLength;
        if (received > bytes.length || received > MAX_AVATAR_BYTES)
          throw new ApiError('http', { status: 413, requestStarted: false });
        bytes.set(value, received - value.byteLength);
      }
    } finally {
      signal.removeEventListener('abort', abort);
      await reader.cancel().catch(() => undefined);
    }
    check();
    inspectAvatar(bytes, declaration.contentType, received);
    if (received !== declaration.fileSize)
      throw new ApiError('invalid-response', { requestStarted: false });
    const snapshot = save(bytes, declaration.filename);
    try {
      check();
      return { ...snapshot, ...declaration };
    } catch (error) {
      snapshot.dispose();
      throw error;
    }
  } finally {
    // Never delete the user's original or an arbitrary content URI.
    if (isPickerCacheCopy(asset.uri)) {
      try {
        if (source.exists) source.delete();
      } catch {
        storageFailed = true;
      }
    }
  }
}
export const avatarTransferPorts: AvatarTransferPorts = {
  now: Date.now,
  externalFetch: expoFetch as typeof fetch,
  multipart: (file, fields) =>
    createNativeMultipartUpload([
      ...Object.entries(fields),
      ['file', { uri: file.uri, name: file.filename, type: file.contentType }],
    ]),
};
