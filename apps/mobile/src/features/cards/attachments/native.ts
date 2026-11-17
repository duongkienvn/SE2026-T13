import { fetch as expoFetch } from 'expo/fetch';
import { Directory, File, Paths } from 'expo-file-system';
import { getDocumentAsync } from 'expo-document-picker';
import { randomUUID } from 'expo-crypto';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { createNativeMultipartUpload } from '../../../infrastructure/api/native-upload';
import { ApiError } from '../../../infrastructure/api/errors';
import type { Attachment } from './api';
import {
  FILE_TYPES,
  FILE_LIMIT,
  fileDeclaration,
  inspectBytes,
  rejectFile,
  safeFilename,
} from './policy';
import type { SelectedFile, TransferPorts } from './transfer';

const root = new Directory(Paths.cache, 'kanvexa-private-attachments');
let storageFailed = false;
/** Called before protected navigation mounts, and synchronously on session end. */
export function clearPrivateAttachmentFiles() {
  try {
    if (root.exists) root.delete();
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
}

function save(bytes: Uint8Array, name: string) {
  if (storageFailed)
    rejectFile(
      'Private temporary storage could not be cleared. Restart the app before sharing files.',
    );
  root.create({ intermediates: true, idempotent: true });
  const directory = new Directory(root, randomUUID());
  directory.create();
  try {
    const file = new File(directory, safeFilename(name));
    file.create();
    file.write(bytes);
    const dispose = () => {
      try {
        if (directory.exists) directory.delete();
      } catch {
        storageFailed = true;
      }
    };
    return { uri: file.uri, dispose };
  } catch {
    try {
      if (directory.exists) directory.delete();
    } catch {
      storageFailed = true;
    }
    throw new ApiError('http', {
      code: 'PRIVATE_STORAGE_FAILED',
      message: 'Could not save the private file. Check device storage.',
    });
  }
}
export async function selectPrivateFile(
  check: () => void,
  signal?: AbortSignal,
): Promise<SelectedFile | null> {
  check();
  const result = await getDocumentAsync({
    type: Object.keys(FILE_TYPES),
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) {
    check();
    return null;
  }
  const asset = result.assets[0];
  if (!asset) return null;
  if (!/^(file:\/\/|content:\/\/)/.test(asset.uri))
    rejectFile('The picker did not return a local file.');
  const source = new File(asset.uri);
  try {
    check();
    // Stat the app-local picker copy, then bound the actual read independently.
    const declaration = fileDeclaration(
      asset.name,
      asset.mimeType ?? source.type,
      source.size,
    );
    if (asset.size !== undefined && asset.size !== source.size)
      rejectFile('The picker size does not match the selected file.');
    const reader = source.readableStream().getReader();
    const abortReader = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener('abort', abortReader, { once: true });
    if (signal?.aborted) abortReader();
    const bytes = new Uint8Array(declaration.fileSize);
    let received = 0;
    try {
      for (;;) {
        check();
        const { done, value } = await reader.read();
        check();
        if (done) break;
        received += value.byteLength;
        if (received > FILE_LIMIT || received > bytes.length)
          rejectFile('The selected file changed or exceeds 10 MiB.');
        bytes.set(value, received - value.byteLength);
      }
    } finally {
      signal?.removeEventListener('abort', abortReader);
      await reader.cancel().catch(() => undefined);
    }
    check();
    if (received !== declaration.fileSize)
      rejectFile('The selected file changed. Select it again.');
    inspectBytes(bytes, declaration.contentType);
    const snapshot = save(bytes, declaration.filename);
    return { ...declaration, ...snapshot };
  } finally {
    // Only the picker-created copy inside this app cache is ours to delete.
    if (asset.uri.startsWith(Paths.cache.uri) && !asset.uri.includes('/../')) {
      try {
        if (source.exists) source.delete();
      } catch {
        storageFailed = true;
      }
    }
  }
}
export function savePrivateDownload(bytes: Uint8Array, row: Attachment) {
  // Never use Content-Disposition, a path, or an arbitrary server extension.
  return save(bytes, safeFilename(row.originalFilename!));
}
export async function sharePrivateFile(
  uri: string,
  mimeType: string,
  check: () => void,
) {
  if (!(await isAvailableAsync()))
    rejectFile('File viewing and sharing are unavailable on this device.');
  check();
  await shareAsync(uri, {
    mimeType,
    dialogTitle: 'View or share private attachment',
  });
}
export async function previewPrivateFile(
  uri: string,
  mimeType: string,
  check: () => void,
) {
  const file = new File(uri);
  if (!(await file.canPreview({ mimeType })))
    rejectFile(
      'No viewer is available for this file. Use Share to choose another app.',
    );
  check();
  await file.preview({ mimeType, title: 'Private attachment' });
}
export const newAttachmentKey = randomUUID;
export const nativeTransferPorts: TransferPorts = {
  now: Date.now,
  externalFetch: expoFetch as typeof fetch,
  multipart: (file, fields) =>
    createNativeMultipartUpload([
      ...Object.entries(fields),
      ['file', { uri: file.uri, name: file.filename, type: file.contentType }],
    ]),
};
