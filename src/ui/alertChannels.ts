/**
 * Browser-side alert channels. DOM APIs stay in the UI layer — the core
 * AlertEngine only knows the AlertChannel interface.
 */

import type { Alert, AlertChannel } from '../core/monitor/alerts';

/** In-app channel: hands alerts to a UI callback for on-screen display. */
export function inAppChannel(onAlert: (alert: Alert) => void): AlertChannel {
  return {
    name: 'in-app',
    deliver: (alert) => onAlert(alert),
  };
}

/**
 * Browser Notification channel. Delivers only where the API exists and the
 * user has granted permission; silently inert otherwise (the in-app channel
 * always shows the alert regardless).
 */
export function browserNotificationChannel(): AlertChannel {
  return {
    name: 'browser-notification',
    deliver: (alert) => {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;
      new Notification(alert.title, { body: alert.message.slice(0, 180), tag: alert.id });
    },
  };
}

/** Ask for browser notification permission (must follow a user gesture). */
export async function requestNotificationPermission(): Promise<string> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}
