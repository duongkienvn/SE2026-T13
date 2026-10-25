export const JWT_ISSUER = 'kanban-api';
export const JWT_AUDIENCE = 'kanban-web';
export const JWT_EXPIRES_IN_SECONDS = 3600;

export interface JwtClaims {
  authVersion?: number;
  sub: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface AuthenticatedUser {
  readonly authVersion: number;
  readonly userId: string;
  /** Verified JWT expiration, in Unix milliseconds; never taken from client data. */
  readonly expiresAt: number;
}
