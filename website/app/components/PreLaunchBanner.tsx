/**
 * PreLaunchBanner — site-wide pre-launch notice.
 *
 * Mounted in `app/layout.tsx` above {children} so it renders on every
 * user-facing route (landing, dashboard, scan/status, legal pages, etc.).
 *
 * Design brief (authorised by Craig):
 *   - Sticky at top of viewport
 *   - Always visible for this phase (NOT dismissible)
 *   - Dark amber/yellow background — warning tone, not alarming
 *   - Full width, readable down to 320px
 *   - Announces to assistive tech via role="status"
 *
 * Restore point: when attorney review clears and public signups open,
 * delete this component and its mount in layout.tsx.
 */
export default function PreLaunchBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 left-0 right-0 z-[100] w-full bg-amber-500 text-amber-950 border-b border-amber-700/40 shadow-sm"
    >
      <div className="mx-auto max-w-7xl px-3 sm:px-6 py-2 text-center text-xs sm:text-sm font-medium leading-snug">
        <span className="font-semibold uppercase tracking-wider mr-1 sm:mr-2">
          Pre-launch
        </span>
        <span>
          &mdash; GateTest is in final validation. Public signups open soon.
          Scans are not yet available for purchase.
        </span>
      </div>
    </div>
  );
}
