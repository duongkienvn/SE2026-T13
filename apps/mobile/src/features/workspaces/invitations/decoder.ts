import { WorkspaceRole } from '@kanban/shared';
import { workspaceId } from '../decoder.ts';

export const invitationStatuses = [
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED',
  'DECLINED',
] as const;
export type InvitationStatus = (typeof invitationStatuses)[number];
const deliveryStates = [
  'UNAVAILABLE',
  'DISPATCHING',
  'SENT',
  'FAILED',
  'UNKNOWN',
] as const;
export type DeliveryState = (typeof deliveryStates)[number];

function invalid(): never {
  throw new Error('Invalid invitation response');
}

export function invitationEmail(value: string) {
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
    ? email
    : undefined;
}

function instant(value: unknown) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return invalid();
  return value;
}

export function decodeInvitation(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const row = value as Record<string, unknown>;
  const id = workspaceId(row.id) ?? invalid();
  const parent = workspaceId(row.workspaceId) ?? invalid();
  const invitedById = workspaceId(row.invitedById) ?? invalid();
  const status =
    invitationStatuses.find((status) => status === row.status) ?? invalid();
  const sendState =
    deliveryStates.find((state) => state === row.sendState) ?? invalid();
  const email =
    typeof row.email === 'string' ? invitationEmail(row.email) : undefined;
  if (row.role !== WorkspaceRole.MEMBER || !email || email !== row.email)
    return invalid();
  return {
    id,
    workspaceId: parent,
    invitedById,
    email,
    role: row.role,
    status,
    sendState,
    expiresAt: instant(row.expiresAt),
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    consumedAt: row.consumedAt === null ? null : instant(row.consumedAt),
    revokedAt: row.revokedAt === null ? null : instant(row.revokedAt),
    declinedAt: row.declinedAt === null ? null : instant(row.declinedAt),
  };
}

export type WorkspaceInvitation = ReturnType<typeof decodeInvitation>;
