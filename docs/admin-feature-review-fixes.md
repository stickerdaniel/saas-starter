# Admin Framework Feature Review — Fix Plan

Review findings from 6 parallel code reviewers across all newly implemented features.
Organized by priority, then by feature.

---

## Critical (must fix before merge)

### 1. Queued Actions: Race condition in chunk completion tracking
**File:** `src/lib/convex/adminFramework/actionJobs.ts` (processActionJobChunk)
**Issue:** Multiple chunks run concurrently via `ctx.scheduler.runAfter(0, ...)`. Between reading `freshJob.processedChunks` and patching, another chunk can update the same counter — classic read-modify-write race. Progress counters can lose updates; `isLastChunk` logic can fail, causing jobs that never complete.
**Fix:** Track completion via a per-chunk bitmap or use a separate `adminActionJobChunks` table where each chunk writes its own status row, and a final aggregation query determines overall completion.

### 2. Queued Actions: Placeholder implementation — actions don't actually execute
**File:** `src/lib/convex/adminFramework/actionJobs.ts:94-107`
**Issue:** The chunk processor loops through record IDs but only increments a counter — it never calls the actual resource action handler. Queued actions appear to succeed but do nothing.
**Fix:** Implement actual dispatch to resource action handlers. Either use `ctx.runMutation(internal.adminFramework.resources[resourceName].runAction, ...)` per chunk, or create an action registry that maps resource names to internal mutation references.

### 3. Queued Actions: Missing authorization check in chunk processor
**File:** `src/lib/convex/adminFramework/actionJobs.ts` (processActionJobChunk)
**Issue:** `internalMutation` skips auth by design, but if an admin is demoted between job creation and chunk execution, the job continues with elevated privileges.
**Fix:** Re-verify admin role inside `processActionJobChunk` before processing. If the admin no longer has permission, mark job as failed with "Admin permissions revoked".

### 4. Expandable: Maxlength validation error missing `{limit}` parameter
**File:** `src/lib/admin/form-utils.ts:181`
**Issue:** The i18n key `admin.resources.form.maxlength_exceeded` expects `{limit}` param, but the call passes no params — users see raw `{limit}` text in error messages.
**Fix:** `args.t('admin.resources.form.maxlength_exceeded', { limit: field.maxlength })`

### 5. Peek: Non-reactive Convex query in relation-peek.svelte
**File:** `src/lib/admin/components/relation-peek.svelte`
**Issue:** Uses one-shot `client.query()` instead of `useQuery()`. Peek popover shows stale data if record changes while open. Inconsistent with `preview-modal.svelte` which correctly uses `useQuery()`.
**Fix:** Refactor to use `useQuery()` with conditional activation (only when `hasFetched` is true), matching the preview modal pattern.

---

## High (should fix)

### 6. Expandable: Missing `aria-expanded` on toggle button
**File:** `src/lib/admin/fields/expandable-content.svelte:44-50`
**Issue:** Toggle button lacks `aria-expanded` attribute. Screen readers can't announce the expanded/collapsed state.
**Fix:** Add `aria-expanded={expanded}` to the `<button>`.

### 7. Expandable: Missing ARIA region labeling
**File:** `src/lib/admin/fields/expandable-content.svelte:28-35`
**Issue:** No `aria-controls` on toggle button linking to the content region.
**Fix:** Add `id` to content div, `aria-controls={contentId}` to button.

### 8. Notifications: Unsafe `as any` type casts
**File:** `src/lib/admin/components/notification-panel.svelte:29,35,45`
**Issue:** Three `id as any` casts bypass Convex's typed ID system.
**Fix:** Use `id as Id<'adminNotifications'>` with proper import from `$lib/convex/_generated/dataModel`.

### 9. Queued Actions: Hardcoded English notification messages
**File:** `src/lib/convex/adminFramework/actionJobs.ts:155-160`
**Issue:** Notification messages use template literals with English text instead of i18n keys. Violates localization rules.
**Fix:** Store i18n message keys + params in the notification record. Render with `$t()` on frontend.

### 10. Copyable: Missing `aria-label` on copy button
**File:** `src/lib/admin/fields/copyable-wrapper.svelte:31-43`
**Issue:** Button has `.sr-only` text but no `aria-label`. Some screen readers may not announce the hidden text inside tooltip triggers.
**Fix:** Add `aria-label={$t('admin.resources.copy.tooltip')}` to the button element.

### 11. Peek: Verify i18n keys exist in all locale files
**File:** `src/i18n/{de,es,fr}.json`
**Issue:** Review flagged potential missing `admin.resources.peek.*` keys. The implementation agent claimed they were added — verify and fix if missing.
**Fix:** Grep for `peek.empty` and `peek.loading` in all 4 locale files. Add if missing.

---

## Medium (improve quality)

### 12. Expandable: Character counter aria-live too noisy
**File:** `src/lib/admin/fields/character-counter.svelte:19`
**Issue:** `aria-live="polite"` announces every keystroke. Excessive screen reader noise.
**Fix:** Only set `aria-live="polite"` when ratio > 0.8 (approaching limit), use `aria-live="off"` below threshold.

### 13. Queued Actions: Chunks can process after cancellation
**File:** `src/lib/convex/adminFramework/actionJobs.ts`
**Issue:** All chunks are scheduled at once via `ctx.scheduler.runAfter(0, ...)`. Cancellation only takes effect when a chunk checks its status at start. Already-running chunks can't be stopped.
**Fix:** Document this as a known limitation. Consider scheduling chunks sequentially (each chunk schedules the next) instead of all-at-once, so cancellation takes effect sooner.

### 14. Queued Actions: Poor error handling in chunks
**File:** `src/lib/convex/adminFramework/actionJobs.ts:108-111`
**Issue:** Outer try-catch marks ALL remaining records in the chunk as failed, even if only one caused the error.
**Fix:** Move try-catch inside the per-record loop so individual failures don't fail the entire chunk.

### 15. Peek: Missing keyboard navigation in preview modal
**File:** `src/lib/admin/components/preview-modal.svelte`
**Issue:** No keyboard shortcut to open detail view from preview (e.g., Enter key).
**Fix:** Add keydown handler in `$effect` that listens for Enter when modal is open.

### 16. Notifications: Verify i18n keys in all locales
**File:** `src/i18n/{de,es,fr}.json`
**Issue:** Same as #11 — verify `admin.notifications.*` keys exist in all locales.
**Fix:** Grep and add if missing.

---

## Low (nice to have)

### 17. Copyable: Add `String()` coercion for `copyValueUsing` return
**File:** `src/lib/admin/fields/index-cell.svelte:140-146`, `detail-value.svelte:118-125`
**Fix:** Wrap `field.copyValueUsing(...)` in `String(...)` for runtime safety.

### 18. Expandable: Potential layout thrashing from scrollHeight
**File:** `src/lib/admin/fields/expandable-content.svelte:20-25`
**Fix:** Replace `$effect` with `useResizeObserver` from runed to only recalculate on actual resize.

### 19. Peek: N+1 query risk for tables with many relation columns
**File:** `src/lib/admin/components/relation-peek.svelte`
**Fix:** Consider a module-level peek cache with 30s TTL for frequently accessed records.

### 20. Queued Actions: Inefficient `countActiveActionJobs`
**File:** `src/lib/convex/adminFramework/actionJobs.ts:237-256`
**Fix:** Uses `.collect().length` on two queries. Consider `@convex-dev/aggregate` for real-time count.

### 21. Queued Actions: No intra-chunk progress updates
**File:** `src/lib/convex/adminFramework/actionJobs.ts:94-111`
**Fix:** Update progress every N records within a chunk for smoother UI progress bar.

### 22. Notifications: `markAllAsRead` one-by-one patching
**File:** `src/lib/convex/adminFramework/notifications.ts:81-97`
**Fix:** Acceptable for <100 notifications. Add code comment documenting the limitation. Consider chunked scheduled mutation for admins with 100+ notifications.

---

## Verification checklist after fixes

- [ ] `bun scripts/static-checks.ts` passes on all modified files
- [ ] `bun run i18n:pull` then verify all 4 locales have all new keys
- [ ] `bun run i18n:push` to sync with Tolgee Cloud
- [ ] Queued action demo actually processes records (not just placeholder)
- [ ] Screen reader testing: expandable, copyable, notification bell
- [ ] Hover peek shows live data (not stale after refactor to useQuery)
