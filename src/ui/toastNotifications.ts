/**
 * Toast notification system for success/error/info/warning alerts.
 * Auto-dismisses after 5 seconds; can be closed manually.
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  duration?: number; // ms, default 5000
  icon?: string; // emoji or icon character
}

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ⓘ',
  warning: '⚠',
};

export function showToast(
  message: string,
  type: ToastType = 'info',
  options: ToastOptions = {},
): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toastId = `toast-${Date.now()}`;
  const duration = options.duration ?? 5000;
  const icon = options.icon ?? ICONS[type];

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.id = toastId;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Close" data-toast-id="${toastId}">×</button>
  `;

  container.appendChild(toast);

  // Close button handler
  const closeBtn = toast.querySelector('.toast-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      toast.remove();
    });
  }

  // Auto-dismiss
  setTimeout(() => {
    if (document.getElementById(toastId)) {
      toast.remove();
    }
  }, duration);
}

export function showSuccess(message: string, duration?: number): void {
  showToast(message, 'success', { duration });
}

export function showError(message: string, duration?: number): void {
  showToast(message, 'error', { duration });
}

export function showInfo(message: string, duration?: number): void {
  showToast(message, 'info', { duration });
}

export function showWarning(message: string, duration?: number): void {
  showToast(message, 'warning', { duration });
}

/**
 * Simple HTML escape for security.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m] ?? m);
}
