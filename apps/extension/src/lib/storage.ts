import type { Session, StoredUser } from '@claude-reset/shared';
import { STORAGE_KEYS, RESET_WINDOW_MS } from '@claude-reset/shared';

// ── Session ───────────────────────────────────────────────────────────────────

export async function getStoredSession(): Promise<Session | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.session);
  return (result[STORAGE_KEYS.session] as Session) ?? null;
}

export async function setStoredSession(session: Session | null): Promise<void> {
  if (session === null) {
    await chrome.storage.local.remove(STORAGE_KEYS.session);
  } else {
    await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
  }
}

// ── User ──────────────────────────────────────────────────────────────────────

export async function getStoredUser(): Promise<StoredUser | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.user);
  return (result[STORAGE_KEYS.user] as StoredUser) ?? null;
}

export async function setStoredUser(user: StoredUser | null): Promise<void> {
  if (user === null) {
    await chrome.storage.local.remove(STORAGE_KEYS.user);
  } else {
    await chrome.storage.local.set({ [STORAGE_KEYS.user]: user });
  }
}

// ── Reset window ──────────────────────────────────────────────────────────────

export async function getResetWindowMs(): Promise<number> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.resetWindowMs);
  return (result[STORAGE_KEYS.resetWindowMs] as number) ?? RESET_WINDOW_MS;
}

export async function setResetWindowMs(ms: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.resetWindowMs]: ms });
}

// ── Nuke everything on sign-out ───────────────────────────────────────────────

export async function clearAllStorage(): Promise<void> {
  await chrome.storage.local.clear();
}
