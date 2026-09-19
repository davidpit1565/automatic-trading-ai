/**
 * Tiny shared "what was last tapped" store for drill-down detail views that
 * need to know WHICH record to show, without threading a navigation
 * parameter through main.ts's `activateView(name)` (which only ever takes a
 * view name). A view that wants a detail drill-down sets the relevant field
 * in a click listener on its own container — which fires before main.ts's
 * document-level delegated [data-nav] listener, since the click bubbles
 * from the target outward — then the detail view reads it on mount.
 */
export const selection: { tradeId: string | null } = { tradeId: null };
