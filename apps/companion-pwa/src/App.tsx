import React from 'react';

/**
 * Companion PWA — Milestone 7
 *
 * This is intentionally a placeholder for M1–M3.
 * The full implementation (Google Sign-In + FCM push subscription registration)
 * lands in Milestone 7.
 *
 * What the full app will do:
 *   1. Sign the user in with Google (same account as the extension)
 *   2. Request Android notification permission
 *   3. Register an FCM Web Push token under users/{uid}/pushSubscriptions
 *   4. Show confirmation that phone notifications are active
 *
 * The PWA service worker (sw.ts, also M7) will handle incoming push events
 * and call self.registration.showNotification() to display them on Android.
 */
export default function App() {
  return (
    <div className="app-root">
      <div className="card">
        <div className="logo">⏱</div>
        <h1>Claude Reset Notifier</h1>
        <p className="status">
          Phone notification setup is coming in <strong>Milestone 7</strong>.
        </p>
        <p className="hint">
          The browser extension is live — install it in Brave to start
          tracking your Claude sessions right now.
        </p>
      </div>
    </div>
  );
}
