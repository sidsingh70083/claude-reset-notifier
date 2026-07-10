/**
 * Notification Strategy — Issue 3
 *
 * Layered approach (in priority order):
 *
 *   1. Badge  — always set (browser running required, badge persists until popup opened)
 *   2. Toast  — if a claude.ai tab is open: inject a styled in-page banner + sound
 *   3. OS     — if no claude.ai tab: fall back to chrome.notifications (OS-level)
 *
 * The toast path and the OS path are mutually exclusive.
 * The badge is always set regardless of which notification path fires.
 *
 * Phone push notifications are NOT handled here — they are fired by the
 * GitHub Actions dispatcher (Milestone 8) independently, regardless of
 * laptop state. Desktop and phone notifications are parallel, additive paths.
 */

import { NOTIFICATION_ID } from '@claude-reset/shared';

// ── Toast injected into claude.ai tab ────────────────────────────────────────
//
// This function is serialized by chrome.scripting.executeScript and re-evaluated
// inside the target page's isolated world. It MUST be 100% self-contained:
//   - No references to any outer-scope variables or imports
//   - No closures
//   - Only browser-native APIs

function injectToastAndSound(): void {
  // Clean up any previous toast from a prior session reset
  document.getElementById('crn-toast')?.remove();
  document.getElementById('crn-style')?.remove();

  // Keyframe animation requires a <style> tag (can't use inline styles for @keyframes)
  const style = document.createElement('style');
  style.id = 'crn-style';
  style.textContent = `
    @keyframes crn-in {
      from { opacity:0; transform:translateY(16px) scale(0.96); }
      to   { opacity:1; transform:translateY(0)    scale(1);    }
    }
    #crn-toast {
      position:fixed; bottom:24px; right:24px; z-index:2147483647;
      background:#1a1a1a; border:1.5px solid #f97316; border-radius:12px;
      color:#e5e5e5; padding:14px 16px; min-width:260px; max-width:320px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
      font-size:14px; line-height:1.4; cursor:default;
      box-shadow:0 8px 32px rgba(0,0,0,0.55),0 0 0 1px rgba(249,115,22,0.12);
      animation:crn-in 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards;
    }
    #crn-row   { display:flex; align-items:center; gap:10px; }
    #crn-texts { flex:1; }
    #crn-title { font-weight:700; font-size:14px; }
    #crn-sub   { font-size:12px; color:#888; margin-top:2px; }
    #crn-x {
      background:none; border:none; color:#555; cursor:pointer;
      font-size:20px; line-height:1; padding:0; flex-shrink:0;
      transition:color 0.15s;
    }
    #crn-x:hover { color:#e5e5e5; }
    #crn-btn {
      display:block; width:100%; margin-top:10px;
      background:#f97316; color:#0d0d0d; border:none; border-radius:7px;
      padding:8px 12px; font-size:13px; font-weight:700; cursor:pointer;
      font-family:inherit; transition:background 0.15s; text-align:center;
    }
    #crn-btn:hover { background:#ea580c; }
  `;
  document.head.appendChild(style);

  const toast = document.createElement('div');
  toast.id = 'crn-toast';
  toast.innerHTML = `
    <div id="crn-row">
      <span style="font-size:22px;flex-shrink:0">✅</span>
      <div id="crn-texts">
        <div id="crn-title">Claude is ready</div>
        <div id="crn-sub">Your 5-hour session has reset</div>
      </div>
      <button id="crn-x" title="Dismiss">×</button>
    </div>
    <button id="crn-btn">Start chatting →</button>
  `;
  document.body.appendChild(toast);

  const dismiss = () => {
    document.getElementById('crn-toast')?.remove();
    document.getElementById('crn-style')?.remove();
  };

  document.getElementById('crn-x')!.onclick = dismiss;
  document.getElementById('crn-btn')!.onclick = () => {
    window.location.href = 'https://claude.ai';
    dismiss();
  };

  // Auto-dismiss after 12 seconds
  setTimeout(dismiss, 12_000);

  // Two-tone notification sound: A5 → E5 (pleasant, not jarring)
  // AudioContext is always available in a live browser tab
  try {
    const ctx = new AudioContext();
    [880, 659].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    // AudioContext blocked by browser policy — silent fail, toast still shows
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fireResetNotification(): Promise<void> {
  // 1. Badge — always, gives a persistent visual cue until the popup is opened
  chrome.action.setBadgeText({ text: '1' });
  chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });

  // 2. Find an open claude.ai tab to inject the toast into
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  const targetTabId = tabs.find((t) => t.id != null)?.id;

  if (targetTabId != null) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: injectToastAndSound,
      });
      // Toast shown — OS notification not needed
      return;
    } catch {
      // Tab not injectable (e.g., it closed between query and inject) — fall through
    }
  }

  // 3. OS notification fallback — fires when no claude.ai tab is open
  chrome.notifications.create(NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '✅ Claude is ready',
    message: 'Your 5-hour session has reset. Click to open Claude.',
    priority: 2,
    requireInteraction: false,
  });
}

/** Called by the popup when it opens — clears the badge. */
export function clearBadge(): void {
  chrome.action.setBadgeText({ text: '' });
}
