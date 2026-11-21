import { useEffect, useMemo, useState } from 'react';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { Avatar } from '../../ui';
import { createAvatarApi } from './avatar-api';
import { privateAvatarPath, type Profile } from './model';
import { savePrivateAvatar } from './native-media';

/** Bytes never enter Query state, base64, remote Image URLs or OS share targets. */
export function PrivateAvatar({
  profile,
  identity,
  size = 112,
  refreshKey = 0,
}: {
  profile: Pick<Profile, 'displayName' | 'avatarUrl' | 'avatarRevision'>;
  identity: SessionIdentity;
  size?: number;
  refreshKey?: number;
}) {
  const data = useMobileData();
  const [file, setFile] = useState<{ uri: string; key: string } | null>(null);
  const path = privateAvatarPath(profile.avatarUrl, identity.userId);
  const key = `${identity.userId}:${identity.generation}:${profile.avatarRevision}:${path}:${refreshKey}`;
  useEffect(() => {
    const controller = new AbortController();
    let temporary: ReturnType<typeof savePrivateAvatar> | undefined;
    setFile(null);
    if (path)
      void createAvatarApi(data.api, identity)
        .read(path, controller.signal)
        .then((result) => {
          data.assertCurrent(identity);
          if (controller.signal.aborted) return;
          temporary = savePrivateAvatar(new Uint8Array(result.bytes));
          if (controller.signal.aborted) {
            temporary.dispose();
            return;
          }
          setFile({ uri: temporary.uri, key });
        })
        .catch(() => {
          /* Safe initials for denied, missing, offline or invalid bytes. */
        });
    return () => {
      controller.abort();
      temporary?.dispose();
    };
  }, [data, path, key, identity.userId, identity.generation]);
  const uri = file?.key === key ? file.uri : undefined;
  const source = useMemo(
    () => (uri ? { uri, cache: 'reload' as const } : undefined),
    [uri],
  );
  return (
    <Avatar key={key} name={profile.displayName} source={source} size={size} />
  );
}
