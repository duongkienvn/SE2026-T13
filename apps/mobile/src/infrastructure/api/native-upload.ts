import { File } from 'expo-file-system';
import type { NativeUpload } from './client.ts';

export interface NativeUriFile {
  readonly uri: string;
  readonly name?: string;
  readonly type?: string;
}
export type MultipartField = readonly [
  name: string,
  value: string | Blob | NativeUriFile,
];

/** Convert local picker URIs into Expo fetch's bytes-backed multipart parts. */
export function createNativeMultipartUpload(
  fields: readonly MultipartField[],
): NativeUpload {
  return {
    kind: 'native-upload',
    createBody() {
      // Expo's bytes-backed File parts are supported at runtime but absent
      // from the global FormData overloads (which only describe DOM Blobs).
      const form = new FormData() as FormData & {
        append(
          name: string,
          value: Pick<File, 'name' | 'type' | 'bytes'>,
        ): void;
      };
      for (const [name, value] of fields) {
        if (/[\r\n"]/.test(name)) throw new Error('Invalid multipart field');
        if (typeof value === 'string' || value instanceof Blob) {
          form.append(name, value);
          continue;
        }
        if (
          !/^(file:\/|content:\/\/)/.test(value.uri) ||
          /[\r\n]/.test((value.name ?? '') + (value.type ?? ''))
        )
          throw new Error('Invalid multipart file');
        const file = new File(value.uri);
        // Expo File implements bytes() rather than extending the global Blob.
        // Forward its reader while preserving a picker's filename/MIME override.
        form.append(name, {
          name: value.name ?? file.name,
          type: value.type ?? file.type,
          bytes: () => file.bytes(),
        });
      }
      return form;
    },
  };
}
