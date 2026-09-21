import { useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Frontend auth state (Phase 1, spec 2.20/2.22): the CSRF token lives in
 * memory only — never localStorage. A 401 from any API call redirects to
 * /login preserving the intended destination.
 */

export interface AuthStateUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
}

export interface AuthState {
  claimed: boolean;
  authenticated: boolean;
  user?: AuthStateUser;
  session?: {
    expiresAt: string;
    absoluteExpiresAt: string;
    reauthUntil: string | null;
  };
  csrfToken?: string;
}

let csrfToken: string | null = null;

export function storeCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** Fired when the API layer receives an auth-required response. */
export const AUTH_REQUIRED_EVENT = 'hermes-webui:auth-required';

export function notifyAuthRequired(): void {
  csrfToken = null;
  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
}

export function authLoginPath(): string {
  const next = window.location.pathname + window.location.search;
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}

/** Plain fetch of the auth state (for imperative flows). */
export async function fetchAuthState(): Promise<AuthState> {
  const response = await fetch('/api/auth/state', { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Auth state failed with ${response.status}`);
  }
  const state = (await response.json()) as AuthState;
  if (state.authenticated && state.csrfToken !== undefined) {
    storeCsrfToken(state.csrfToken);
  }
  return state;
}

/** Authenticated POST with the in-memory CSRF token (Phase 1 spec 2.12). */
export async function authPost(path: string, body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  errorCode?: string;
  errorMessage?: string;
  csrfToken?: string;
}> {
  const token = csrfToken;
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token !== null ? { 'x-csrf-token': token } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    csrfToken?: string;
    error?: { code?: string; message?: string };
  };
  if (response.ok && payload.csrfToken !== undefined) {
    storeCsrfToken(payload.csrfToken);
  }
  return {
    ok: response.ok,
    status: response.status,
    errorCode: payload.error?.code,
    errorMessage: payload.error?.message,
    csrfToken: payload.csrfToken,
  };
}

/** Revokes the current session server-side (cookie cleared by the server). */
export async function logout(): Promise<void> {
  await authPost('/api/auth/logout', {});
  storeCsrfToken(null);
}

export const authStateQuery = {
  queryKey: ['auth-state'] as const,
  queryFn: fetchAuthState,
  staleTime: 30_000,
};

export function useAuthState() {
  return useQuery(authStateQuery);
}

/** Clears cached auth state (call after logout). */
export function useInvalidateAuthState() {
  const queryClient = useQueryClient();
  return () => {
    storeCsrfToken(null);
    void queryClient.invalidateQueries({ queryKey: ['auth-state'] });
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth-state' });
  };
}
