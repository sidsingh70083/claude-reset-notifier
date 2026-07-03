import React, { useState } from 'react';
import type { StoredUser } from '@claude-reset/shared';

interface SignInProps {
  onSignIn: (user: StoredUser) => void;
}

export default function SignIn({ onSignIn }: SignInProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSignIn() {
    setStatus('loading');
    setErrorMsg('');
    try {
      // Lazy import keeps Firebase out of the initial bundle parse
      const { signInWithGoogle } = await import('../lib/auth');
      const user = await signInWithGoogle();
      onSignIn(user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      setErrorMsg(msg);
      setStatus('error');
    }
  }

  return (
    <div className="signin-root">
      <div className="signin-logo">⏱</div>
      <h1 className="signin-title">Claude Reset Notifier</h1>
      <p className="signin-sub">
        Sign in once to start tracking your Claude session automatically.
      </p>

      <button
        className="btn-primary btn-google"
        onClick={() => void handleSignIn()}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Signing in…' : 'Sign in with Google'}
      </button>

      {status === 'error' && (
        <p className="error-msg">{errorMsg}</p>
      )}

      <p className="signin-hint">
        A Google popup will appear. Make sure pop-ups are not blocked for this extension.
      </p>
    </div>
  );
}
