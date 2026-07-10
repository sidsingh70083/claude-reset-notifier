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

// ── Mid-session flag ──────────────────────────────────────────────────────────
//
// Set to true when the recovery scan detects existing Claude messages but
// cannot extract a machine-readable timestamp. This tells the popup to show
// an informative "session in progress, start time unknown" state rather than
// pretending nothing is happening.
// Cleared automatically when a new session starts with a known timestamp.

export async function getMidSessionDetected(): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.midSessionDetected);
  return (result[STORAGE_KEYS.midSessionDetected] as boolean) ?? false;
}

export async function setMidSessionDetected(value: boolean): Promise<void> {
  if (!value) {
    await chrome.storage.local.remove(STORAGE_KEYS.midSessionDetected);
  } else {
    await chrome.storage.local.set({ [STORAGE_KEYS.midSessionDetected]: true });
  }
}

// ── Nuke everything on sign-out ───────────────────────────────────────────────

export async function clearAllStorage(): Promise<void> {
  await chrome.storage.local.clear();
}
