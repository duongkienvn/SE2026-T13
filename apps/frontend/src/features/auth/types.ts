/*
 * Frontend copies of the Backend Authentication contract (issue #16/#17),
 * checked against the real backend in #25. Replace with `@kanban/shared`
 * exports once the backend publishes them.
 */

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  /** Lifetime of the access token in seconds. */
  expiresIn: number;
  user: User;
}

export interface UpdateProfileRequest {
  displayName?: string;
  avatarUrl?: string | null;
}
