/** Only destinations whose identifiers can be validated without fetching data. */
export type PublicRoute =
  | '/sign-in'
  | '/sign-up'
  | '/forgot-password'
  | '/reset-password'
  | '/verify-email';

declare const resourceIdBrand: unique symbol;
export type ResourceId = string & { readonly [resourceIdBrand]: true };
export type ResourcePath =
  | `/workspaces/${ResourceId}`
  | `/boards/${ResourceId}`
  | `/boards/${ResourceId}/cards/${ResourceId}`
  | `/boards/${ResourceId}/${'calendar' | 'table'}`;
export type DestinationPath =
  | `/${'home' | 'tasks' | 'boards' | 'inbox' | 'search' | 'settings' | 'invitation'}`
  | ResourcePath;

export type Destination =
  | { kind: 'tab'; tab: 'home' | 'tasks' | 'boards' | 'inbox' }
  | { kind: 'workspace'; workspaceId: ResourceId }
  | { kind: 'board'; boardId: ResourceId }
  | { kind: 'card'; boardId: ResourceId; cardId: ResourceId }
  | { kind: 'boardView'; boardId: ResourceId; view: 'calendar' | 'table' }
  | { kind: 'screen'; screen: 'search' | 'settings' | 'invitation' };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseResourceId(value: string): ResourceId | null {
  return uuid.test(value) ? (value.toLowerCase() as ResourceId) : null;
}

export function parsePath(path: string): Destination | null {
  // Reject encoding entirely: no encoded separators, traversal, or double decoding.
  if (!path.startsWith('/') || /[%?#\\\s]/.test(path) || path.includes('//'))
    return null;
  const parts = path.slice(1).split('/');
  if (parts.length === 1) {
    const name = parts[0];
    if (
      name === 'home' ||
      name === 'tasks' ||
      name === 'boards' ||
      name === 'inbox'
    )
      return { kind: 'tab', tab: name };
    if (name === 'search' || name === 'settings' || name === 'invitation')
      return { kind: 'screen', screen: name };
  }
  const resourceId = parseResourceId(parts[1] ?? '');
  if (parts.length === 2 && parts[0] === 'workspaces' && resourceId)
    return { kind: 'workspace', workspaceId: resourceId };
  if (parts[0] === 'boards' && resourceId) {
    const boardId = resourceId;
    if (parts.length === 2) return { kind: 'board', boardId };
    if (parts.length === 3 && (parts[2] === 'calendar' || parts[2] === 'table'))
      return { kind: 'boardView', boardId, view: parts[2] };
    const cardId = parseResourceId(parts[3] ?? '');
    if (parts.length === 4 && parts[2] === 'cards' && cardId)
      return { kind: 'card', boardId, cardId };
  }
  return null;
}

export function destinationPath(destination: Destination): DestinationPath {
  switch (destination.kind) {
    case 'tab':
      return `/${destination.tab}`;
    case 'screen':
      return `/${destination.screen}`;
    case 'workspace':
      return `/workspaces/${destination.workspaceId}`;
    case 'board':
      return `/boards/${destination.boardId}`;
    case 'card':
      return `/boards/${destination.boardId}/cards/${destination.cardId}`;
    case 'boardView':
      return `/boards/${destination.boardId}/${destination.view}`;
  }
}

export function parseLink(input: string): Destination | null {
  // Check the raw authority and path before URL normalization can erase traversal.
  const https = /^https:\/\/kanvexa\.tech(\/[^?#]*)$/i.exec(input);
  if (https) return parsePath(https[1]);
  const scheme = /^kanvexa-dev:\/\/(\/?[^?#]*)$/i.exec(input);
  return scheme ? parsePath(`/${scheme[1].replace(/^\//, '')}`) : null;
}
