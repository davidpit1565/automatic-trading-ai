/**
 * Loading state management: spinners, overlays, and skeleton placeholders.
 */

export function showLoadingOverlay(message = 'Loading...', timeout = 30000): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.id = `overlay-${Date.now()}`;
  overlay.innerHTML = `
    <div class="loading-modal">
      <div class="spinner lg"></div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;

  document.body.appendChild(overlay);

  // Auto-dismiss after timeout
  const timeoutId = setTimeout(() => {
    hideLoadingOverlay();
  }, timeout);

  // Return cleanup function
  return () => {
    clearTimeout(timeoutId);
    hideLoadingOverlay();
  };
}

export function hideLoadingOverlay(): void {
  const overlays = document.querySelectorAll('.loading-overlay');
  overlays.forEach((o) => o.remove());
}

export function createLoadingSpinner(
  size: 'sm' | 'md' | 'lg' = 'md',
): HTMLElement {
  const spinner = document.createElement('div');
  spinner.className = `spinner ${size}`;
  return spinner;
}

export function addLoadingState(element: HTMLElement, message = 'Loading...'): void {
  element.classList.add('loading-state');
  const spinner = createLoadingSpinner('sm');
  const text = document.createElement('span');
  text.className = 'loading-inline';
  text.textContent = message;
  element.appendChild(spinner);
  element.appendChild(text);
}

export function removeLoadingState(element: HTMLElement): void {
  element.classList.remove('loading-state');
  element.querySelectorAll('.spinner, .loading-inline').forEach((el) => el.remove());
}

/**
 * Create a skeleton placeholder for data loading.
 */
export function createSkeletonLine(width = '100%'): HTMLElement {
  const line = document.createElement('div');
  line.className = 'skeleton skeleton-line';
  line.style.width = width;
  return line;
}

export function createSkeletonTitle(): HTMLElement {
  const title = document.createElement('div');
  title.className = 'skeleton skeleton-title';
  return title;
}

/**
 * Show empty state with icon, title, and optional action button.
 */
export function showEmptyState(
  container: HTMLElement,
  icon: string,
  title: string,
  text: string,
  actionLabel?: string,
  actionCallback?: () => void,
): void {
  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';
  emptyState.innerHTML = `
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${escapeHtml(title)}</div>
    <div class="empty-state-text">${escapeHtml(text)}</div>
  `;

  if (actionLabel && actionCallback) {
    const button = document.createElement('button');
    button.className = 'primary empty-state-action';
    button.textContent = actionLabel;
    button.addEventListener('click', actionCallback);
    emptyState.appendChild(button);
  }

  container.innerHTML = '';
  container.appendChild(emptyState);
}

/**
 * Simple HTML escape.
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
