import React, { useEffect, useState } from 'react';
import type { Session } from '@claude-reset/shared';

interface CountdownProps {
  session: Session;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function Countdown({ session }: CountdownProps) {
  const [remaining, setRemaining] = useState(() => session.resetTime - Date.now());

  useEffect(() => {
    // Sync immediately, then tick every minute
    setRemaining(session.resetTime - Date.now());
    const interval = setInterval(() => {
      setRemaining(session.resetTime - Date.now());
    }, 60_000);
    return () => clearInterval(interval);
  }, [session.resetTime]);

  const clampedRemaining = Math.max(0, remaining);

  return (
    <div className="countdown-root">
      <div className="time-row">
        <span className="time-label">Session started</span>
        <span className="time-value">{formatTime(session.sessionStart)}</span>
      </div>
      <div className="time-row">
        <span className="time-label">Claude ready</span>
        <span className="time-value accent">{formatTime(session.resetTime)}</span>
      </div>

      <div className="timer-block">
        <span className="timer-label">Time remaining</span>
        <span className="timer-value">{formatRemaining(clampedRemaining)}</span>
      </div>
    </div>
  );
}
