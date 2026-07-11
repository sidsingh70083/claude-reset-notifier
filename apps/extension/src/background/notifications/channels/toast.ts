import type { NotificationChannel } from '../types';
import type { ResetNotificationEvent } from '@claude-reset/shared';

/**
 * This function is serialized by chrome.scripting.executeScript and
 * re-evaluated inside the target tab's isolated content-script world. It
 * MUST be self-contained — no references to any outer-scope variables or
 * imports, only browser-native APIs plus chrome.runtime.sendMessage (which
 * IS available here, since func-based executeScript injection runs in the
 * isolated content-script context, not the page's own MAIN world).
 *
 * Deliberately contains NO audio code — sound is SoundNotifier's exclusive
 * responsibility now. A toast injection failure or a sound failure can
 * never affect each other.
 */
function injectToast(title: string, subtitle: string): void {
  document.getElementById('crn-toast')?.remove();
  document.getElementById('crn-style')?.remove();

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
        <div id="crn-title">${title}</div>
        <div id="crn-sub">${subtitle}</div>
      </div>
      <button id="crn-x" title="Dismiss">×</button>
    </div>
    <button id="crn-btn">Start chatting →</button>
  `;
  document.body.appendChild(toast);

  const dismiss = (markSeen: boolean) => {
    document.getElementById('crn-toast')?.remove();
    document.getElementById('crn-style')?.remove();
    if (markSeen) {
      chrome.runtime.sendMessage({ type: 'MARK_AS_SEEN' }).catch(() => {
        /* SW may be asleep — harmless, popup's own Mark as Seen button still works */
      });
    }
  };

  document.getElementById('crn-x')!.onclick = () => dismiss(true);
  document.getElementById('crn-btn')!.onclick = () => {
    window.location.href = 'https://claude.ai';
    dismiss(true);
  };

  // Auto-dismiss after 12 seconds — does NOT count as "seen" (user may not
  // have noticed it), so this path does not send MARK_AS_SEEN.
  setTimeout(() => dismiss(false), 12_000);
}

export const toastNotifier: NotificationChannel = {
  id: 'toast',

  isEnabled(prefs) {
    return prefs.channels.toast;
  },

  async notify(event: ResetNotificationEvent) {
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    const targetTabId = tabs.find((t) => t.id != null)?.id;

    // No open claude.ai tab — nothing for this channel to inject into.
    // This is not a failure, just a no-op; DesktopNotifier independently
    // decides whether IT can run, it doesn't need this channel to fail first.
    if (targetTabId == null) return;

    const title = event.kind === 'reminder' ? 'Still waiting on Claude' : 'Claude is ready';
    const subtitle =
      event.kind === 'reminder'
        ? 'Your session reset a little while ago'
        : 'Your session has reset';

    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: injectToast,
      args: [title, subtitle],
    });
  },
};
