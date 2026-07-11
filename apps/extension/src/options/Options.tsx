import React, { useEffect, useState, useCallback } from 'react';
import type { NotificationPreferences } from '@claude-reset/shared';
import { REMINDER_INTERVALS_MINUTES, type ReminderMode } from '@claude-reset/shared';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../background/notifications/preferences';
import { listBuiltinSounds } from '../background/notifications/sound-sources';

const VOLUME_STEPS = [0, 25, 50, 75, 100] as const;

export default function Options() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'playing' | 'error'>('idle');

  const load = useCallback(async () => {
    setPrefs(await getNotificationPreferences());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(update: Partial<NotificationPreferences>) {
    const updated = await updateNotificationPreferences(update);
    setPrefs(updated);
  }

  async function handleTestSound(soundId: string) {
    setTestStatus('playing');
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'TEST_SOUND',
        soundId,
      })) as { ok: boolean } | undefined;
      setTestStatus(response?.ok ? 'idle' : 'error');
    } catch {
      setTestStatus('error');
    }
  }

  if (!prefs) {
    return <div className="loading">Loading settings…</div>;
  }

  const builtinSounds = listBuiltinSounds();

  return (
    <div className="options-root">
      <header className="options-header">
        <span className="header-logo">⏱ Claude Reset Notifier</span>
        <h1>Settings</h1>
      </header>

      {/* ── Notification channels ─────────────────────────────────────────── */}
      <section className="options-section">
        <h2>Notification channels</h2>
        <p className="section-hint">
          Each channel runs independently — disabling one never affects the others.
        </p>

        <label className="toggle-row">
          <span>Badge on extension icon</span>
          <input
            type="checkbox"
            checked={prefs.channels.badge}
            onChange={(e) => void patch({ channels: { ...prefs.channels, badge: e.target.checked } })}
          />
        </label>

        <label className="toggle-row">
          <span>In-page toast (when Claude is open)</span>
          <input
            type="checkbox"
            checked={prefs.channels.toast}
            onChange={(e) => void patch({ channels: { ...prefs.channels, toast: e.target.checked } })}
          />
        </label>

        <label className="toggle-row">
          <span>Desktop notification</span>
          <input
            type="checkbox"
            checked={prefs.channels.desktop}
            onChange={(e) => void patch({ channels: { ...prefs.channels, desktop: e.target.checked } })}
          />
        </label>

        <label className="toggle-row">
          <span>Sound</span>
          <input
            type="checkbox"
            checked={prefs.channels.sound}
            onChange={(e) => void patch({ channels: { ...prefs.channels, sound: e.target.checked } })}
          />
        </label>
      </section>

      {/* ── Sound settings ─────────────────────────────────────────────────── */}
      <section className="options-section">
        <h2>Sound</h2>

        <label className="toggle-row">
          <span>Enable notification sound</span>
          <input
            type="checkbox"
            checked={prefs.sound.enabled}
            onChange={(e) => void patch({ sound: { ...prefs.sound, enabled: e.target.checked } })}
          />
        </label>

        <div className="field-row">
          <span className="field-label">Notification sound</span>
          <div className="sound-picker-row">
            <select
              value={prefs.sound.soundId}
              onChange={(e) => void patch({ sound: { ...prefs.sound, soundId: e.target.value } })}
            >
              {builtinSounds.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              className="btn-secondary"
              onClick={() => void handleTestSound(prefs.sound.soundId)}
              disabled={testStatus === 'playing'}
            >
              {testStatus === 'playing' ? 'Playing…' : '🔊 Test Sound'}
            </button>
          </div>
          {testStatus === 'error' && (
            <p className="error-msg">Couldn&apos;t play sound — check the service worker console.</p>
          )}
        </div>

        <div className="field-row">
          <span className="field-label">Volume</span>
          <div className="radio-group">
            <label className="radio-row">
              <input
                type="radio"
                name="volumeMode"
                checked={prefs.sound.volumeMode === 'system'}
                onChange={() => void patch({ sound: { ...prefs.sound, volumeMode: 'system' } })}
              />
              <span>Use system volume</span>
            </label>
            <label className="radio-row">
              <input
                type="radio"
                name="volumeMode"
                checked={prefs.sound.volumeMode === 'extension'}
                onChange={() => void patch({ sound: { ...prefs.sound, volumeMode: 'extension' } })}
              />
              <span>Extension volume</span>
            </label>
          </div>

          {prefs.sound.volumeMode === 'extension' && (
            <div className="volume-steps">
              {VOLUME_STEPS.map((step) => (
                <button
                  key={step}
                  className={`volume-step ${prefs.sound.volumePercent === step ? 'active' : ''}`}
                  onClick={() => void patch({ sound: { ...prefs.sound, volumePercent: step } })}
                >
                  {step}%
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Reminder mode ──────────────────────────────────────────────────── */}
      <section className="options-section">
        <h2>Reminder mode</h2>
        <p className="section-hint">
          After the first notification, get reminded again until you open Claude,
          dismiss a notification, or mark it as seen.
        </p>

        <div className="radio-group">
          <label className="radio-row">
            <input
              type="radio"
              name="reminderMode"
              checked={prefs.reminder.mode === 'disabled'}
              onChange={() => void patch({ reminder: { mode: 'disabled' as ReminderMode } })}
            />
            <span>Disabled</span>
          </label>
          {REMINDER_INTERVALS_MINUTES.map((minutes) => (
            <label className="radio-row" key={minutes}>
              <input
                type="radio"
                name="reminderMode"
                checked={prefs.reminder.mode === minutes}
                onChange={() => void patch({ reminder: { mode: minutes } })}
              />
              <span>Every {minutes} minutes</span>
            </label>
          ))}
        </div>
      </section>

      <footer className="options-footer">
        <p>Changes save automatically.</p>
      </footer>
    </div>
  );
}
