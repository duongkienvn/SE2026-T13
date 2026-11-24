import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { ApiError } from '../../infrastructure/api/errors';

/** App-private cache only: never Documents, a shared folder or a public cache. */
const root = new Directory(Paths.cache, 'kanvexa-private-exports');
let storageFailed = false;

/** Cold start and every session end. A failure fences new exports. */
export function clearPrivateExportFiles(): boolean {
  try {
    if (root.exists) root.delete();
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
  return !storageFailed;
}

export function exportStorageAvailable(): boolean {
  return !storageFailed;
}

export interface PrivateExportFile {
  readonly uri: string;
  /** Best-effort delete of this export's own random directory. */
  dispose(): boolean;
}

const SAFE_NAME =
  /^kanvexa-(account|board-[0-9a-f-]{36})-\d{4}-\d{2}-\d{2}\.(json|csv)$/;

/**
 * Called only after a complete, validated 200 response. The synchronous write
 * returns after the bytes are on disk, so the URI is never handed out early.
 */
export function savePrivateExport(
  bytes: Uint8Array,
  filename: string,
): PrivateExportFile {
  if (storageFailed)
    throw new ApiError('http', {
      code: 'PRIVATE_STORAGE_UNAVAILABLE',
      requestStarted: false,
    });
  if (!SAFE_NAME.test(filename))
    throw new ApiError('invalid-response', { status: 200 });
  let directory: Directory | null = null;
  const remove = () => {
    try {
      if (directory?.exists) directory.delete();
      return true;
    } catch {
      storageFailed = true;
      return false;
    }
  };
  try {
    root.create({ intermediates: true, idempotent: true });
    directory = new Directory(root, randomUUID());
    directory.create();
    const file = new File(directory, filename);
    file.create();
    file.writeSync(bytes);
    if (file.size !== bytes.byteLength) throw new Error('short write');
    let disposed = false;
    return {
      uri: file.uri,
      dispose() {
        if (disposed) return !storageFailed;
        disposed = true;
        return remove();
      },
    };
  } catch {
    remove();
    throw new ApiError('http', {
      code: 'PRIVATE_STORAGE_FAILED',
      requestStarted: false,
    });
  }
}

export type HandoffResult = 'offered' | 'unavailable';

/** Resolves when the OS sheet closes. That is not proof anything was saved. */
export async function shareExport(
  uri: string,
  mimeType: string,
  check: () => void,
): Promise<HandoffResult> {
  if (!(await isAvailableAsync())) return 'unavailable';
  check();
  await shareAsync(uri, {
    mimeType,
    UTI:
      mimeType === 'text/csv'
        ? 'public.comma-separated-values-text'
        : 'public.json',
    dialogTitle: 'Share or save Kanvexa export',
  });
  return 'offered';
}

export async function openExport(
  uri: string,
  mimeType: string,
  check: () => void,
): Promise<HandoffResult> {
  const file = new File(uri);
  if (!(await file.canPreview({ mimeType }))) return 'unavailable';
  check();
  await file.preview({ mimeType, title: 'Kanvexa export' });
  return 'offered';
}
