import { reactive, readonly } from 'vue';
import { api, setCsrfToken, type PublicUser, type SessionInfo } from './api';

/** The logged-in user, shared by router guards and views. */
const state = reactive({
  user: null as PublicUser | null,
  loaded: false,
});

export const session = readonly(state);

function apply(info: SessionInfo): void {
  state.user = info.user;
  state.loaded = true;
  setCsrfToken(info.csrfToken);
}

/** Loads the session once (on first navigation); later calls are no-ops. */
export async function ensureSessionLoaded(): Promise<void> {
  if (state.loaded) return;
  try {
    apply(await api.get<SessionInfo>('auth/session'));
  } catch {
    // Server unreachable – treat as logged out; the login page shows the problem.
    apply({ user: null, csrfToken: null });
  }
}

export async function login(
  username: string,
  password: string,
  stayLoggedIn: boolean,
): Promise<PublicUser> {
  const info = await api.post<SessionInfo>('auth/login', { username, password, stayLoggedIn });
  apply(info);
  return info.user!;
}

export async function logout(): Promise<void> {
  try {
    await api.post('auth/logout');
  } finally {
    clearSession();
  }
}

export function clearSession(): void {
  apply({ user: null, csrfToken: null });
}

export function setCurrentUser(user: PublicUser): void {
  state.user = user;
}
