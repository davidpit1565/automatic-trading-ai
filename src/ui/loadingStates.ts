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
    overlay.remove();
  }, timeout);

  // Return cleanup function — removes only THIS overlay, so two overlapping
  // callers each get their own independent show/hide instead of one hiding
  // the other's still-in-flight overlay.
  return () => {
    clearTimeout(timeoutId);
    overlay.remove();
  };
}

/** Removes every overlay currently shown — a hard reset, not a per-call cleanup. */
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
 * Shimmering row placeholders matching a `.row` / `.stack-card` list's own
 * geometry (icon + two lines, a value on the right) — for the first paint of
 * a list before its data has loaded, so that moment reads as "loading"
 * rather than as blank space where content belongs.
 */
export function skeletonRowsHtml(count = 2): string {
  // Fixed pixel widths, not the %-based .w-40/.w-60 modifiers used inside
  // the markets grid — those percentages resolve against a grid track's
  // concrete width, but .skeleton-lines here is a plain flex column with no
  // width of its own, so a percentage on its children has nothing to
  // resolve against and collapses to ~0.
  const row = `
    <div class="skeleton-list-row">
      <div class="row-main"><span class="skeleton-dot"></span>
        <div class="skeleton-lines"><span class="skeleton-bar" style="width:72px"></span><span class="skeleton-bar" style="width:52px"></span></div>
      </div>
      <div class="skeleton-side"><span class="skeleton-bar" style="width:56px"></span></div>
    </div>`;
  return row.repeat(count);
}

/**
 * Shimmering placeholders shaped like Home's own `.market-card` (icon +
 * name, a big price bar, a sparkline-shaped bar) — for the first paint of
 * the "Markets" strip before its data has loaded. Every sibling section on
 * Home (Top movers, Open positions, Recent activity) already gets a real
 * skeleton via `skeletonRowsHtml`; this strip was the one left rendering
 * nothing at all for that same moment.
 */
export function skeletonMarketCardsHtml(count = 3): string {
  const card = `
    <div class="skeleton-market-card">
      <div class="skeleton-top"><span class="skeleton-dot"></span><span class="skeleton-bar" style="width:64px"></span></div>
      <span class="skeleton-bar mc-price"></span>
      <span class="skeleton-bar mc-spark"></span>
    </div>`;
  return card.repeat(count);
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
