import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { signInWithGoogle, watchAuthState } from './lib/auth';
import { registerForPushNotifications, type PushRegistrationResult } from './lib/push';

type Status = 'loading' | 'signed-out' | 'signed-in' | 'registering' | 'registered' | 'error';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const unsubscribe = watchAuthState((u) => {
      setUser(u);
      setStatus(u ? 'signed-in' : 'signed-out');
    });
    return unsubscribe;
  }, []);

  async function handleSignIn() {
    try {
      const signedInUser = await signInWithGoogle();
      setUser(signedInUser);
      setStatus('signed-in');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Sign-in failed');
      setStatus('error');
    }
  }

  async function handleEnableNotifications() {
    if (!user) return;
    setStatus('registering');

    const result: PushRegistrationResult = await registerForPushNotifications(user.uid);

    if (result.ok) {
      setStatus('registered');
    } else {
      setErrorMessage(result.message);
      setStatus('error');
    }
  }

  return (
    <div className="app-root">
      <div className="card">
        <div className="logo">⏱</div>
        <h1>Claude Reset Notifier</h1>

        {status === 'loading' && <p className="status">Loading…</p>}

        {status === 'signed-out' && (
          <>
            <p className="status">Sign in with the same Google account you used in the browser extension.</p>
            <button className="btn-primary" onClick={() => void handleSignIn()}>
              Sign in with Google
            </button>
          </>
        )}

        {(status === 'signed-in' || status === 'registering') && (
          <>
            <p className="status">Signed in as {user?.email}</p>
            <button
              className="btn-primary"
              onClick={() => void handleEnableNotifications()}
              disabled={status === 'registering'}
            >
              {status === 'registering' ? 'Enabling…' : 'Enable Notifications'}
            </button>
          </>
        )}

        {status === 'registered' && (
          <>
            <p className="status success">✅ Notifications enabled</p>
            <p className="hint">
              You can close this page now — you'll get a notification here whenever
              your Claude session resets, even if your laptop is off.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <p className="status error">Something went wrong: {errorMessage}</p>
            <button className="btn-primary" onClick={() => void handleEnableNotifications()}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
