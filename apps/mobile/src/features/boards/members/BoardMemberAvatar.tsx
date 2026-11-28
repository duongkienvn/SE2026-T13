import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { Avatar } from '../../../ui';
import type { BoardMember } from './api';
import { avatarUri, memberAvatarOptions } from './assignee-avatars';

/** Private avatars use the Board roster fence and never put bearer tokens in Image URLs. */
export function BoardMemberAvatar({
  member,
  identity,
  boardId,
}: {
  member: BoardMember;
  identity: SessionIdentity;
  boardId: string;
}) {
  const data = useMobileData();
  const { user } = member;
  // Shares the assignee photo cache entry for the same user and revision.
  const image = useQuery(
    memberAvatarOptions(data, identity, boardId, user, true),
  );
  const uri = avatarUri(user, image);
  const source = useMemo(() => (uri ? { uri } : undefined), [uri]);
  return <Avatar name={user.displayName} source={source} />;
}
