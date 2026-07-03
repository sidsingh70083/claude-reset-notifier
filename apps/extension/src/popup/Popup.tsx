import React, { useEffect, useState, useCallback } from 'react';
import type { Session, StoredUser } from '@claude-reset/shared';
import { getStoredSession, getStoredUser } from '../lib/storage';
import SignIn from './SignIn';
import Countdown from './Countdown';

type PopupState = 'loading' | 'signed-out' | 'idle' | 'active' | 'ready';

export default function Popup() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<PopupState>('loading');

  const loadState = useCallback(async () => {
    const [storedUser, storedSession] = await Promise.all([
      getStoredUser(),
      getStoredSession(),
    ]);

    setUser(storedUser);
    setSession(storedSession);

    if (!storedUser) {
      setState('signed-out');
    } else if (!storedSession) {
      setState('idle');
    } else if (storedSession.notified || Date.now() >= storedSession.resetTime) {
      setState('ready');
    } else {
      setState('active');
    }
  }, []);

  useEffect(() => {
    void loadState();
    // Re-check every 30 s in case background SW updated storage while popup was open
    const interval = setInterval(() => void loadState(), 30_000);
    return () => clearInterval(interval);
  }, [loadState]);

  async function handleSignOut() {
    const { signOutUser } = await import('../lib/auth');
    await signOutUser();
    setUser(null);
    setSession(null);
    setState('signed-out');
  }

  if (state === 'loading') {
    return <div className="loading">Loading…</div>;
  }

  if (state === 'signed-out') {
    return <SignIn onSignIn={(u) => { setUser(u); setState('idle'); }} />;
  }

  return (
    <div className="popup-root">
      <header className="popup-header">
        <span className="header-logo">⏱ Claude Reset</span>
        <button className="btn-ghost" onClick={() => void handleSignOut()}>
          Sign out
        </button>
      </header>

      <main className="popup-main">
        {state === 'active' && session && (
          <Countdown session={session} />
        )}

        {state === 'ready' && (
          <div className="state-card">
            <div className="state-icon">✅</div>
            <p className="state-title">Claude is ready</p>
            <a
              href="https://claude.ai"
              target="_blank"
              rel="noreferrer"
              className="btn-primary"
            >
              Open Claude
            </a>
          </div>
        )}

        {state === 'idle' && (
          <div className="state-card">
            <div className="state-icon">💤</div>
            <p className="state-title">No active session</p>
            <p className="state-sub">
              Send a message on Claude to start the timer automatically.
            </p>
          </div>
        )}
      </main>

      <footer className="popup-footer">
        <span>{user?.email ?? ''}</span>
      </footer>
    </div>
  );
}
