import type { Breadcrumb, Event } from '@sentry/sveltekit';
import { projectBreadcrumb, projectDiagnosticEvent } from '#lib/diagnostics/sentry-projection.js';

// Every error event, transaction and breadcrumb of both runtimes passes through
// here before it is sent. No sink gets failure content outside dev, so Sentry
// gets the failure's shape only: types, frames, route and the correlation ids.
// A URL keeps its origin, and a request URL the SvelteKit route id the SDK
// recorded: a path can name the page or document the user opened, Better Auth
// carries a password-reset token as a path segment, and a reset link carries
// its `?token=`.

/** Projects an error or transaction event in place onto what Sentry may receive. */
export function scrubEvent<T extends Event>(event: T): T {
	return projectDiagnosticEvent(event);
}

/** Projects a breadcrumb as it is recorded, so the scope never holds its data. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
	return projectBreadcrumb(breadcrumb);
}
