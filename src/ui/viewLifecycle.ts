/**
 * Optional lifecycle a view renderer can return so `main.ts` can stop its
 * background polling (setInterval/WebSocket/live-ticker) when the user
 * navigates away, and restart it when they come back — without that, every
 * view visited once keeps polling forever in the background, competing for
 * the shared Kraken request queue even while off-screen.
 */
export interface ViewHandle {
  pause(): void;
  resume(): void;
}
