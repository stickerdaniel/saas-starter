import type { AnalyticsController } from './controller';

/**
 * The document's analytics controller, for code outside the root component.
 *
 * Set only from `onMount` in `analytics-root.svelte`, so it stays undefined during
 * SSR and a server request can never reach another request's controller. Every
 * helper is a no-op until then and whenever analytics is disabled.
 */
let controller: AnalyticsController | undefined;

export function setAnalyticsController(next: AnalyticsController | undefined): void {
	controller = next;
}

/**
 * Sends a product event if the visitor has allowed analytics. Use primitive values
 * that describe the product, never personal data such as names, emails or free text.
 */
export function captureAnalyticsEvent(
	event: string,
	properties?: Record<string, string | number | boolean>
): void {
	controller?.capture(event, properties);
}

/**
 * Wraps a sign-out or an impersonation start or stop. Analytics stays closed from
 * before the request until the session store has fetched the session again after
 * it, so nothing is attributed to the account that is leaving. When `changed` says
 * the request was refused, analytics resumes under the unchanged session. A request
 * that throws may still have changed the session, so it counts as changed.
 */
export async function duringAuthChange<T>(
	run: () => Promise<T>,
	changed: (result: T) => boolean
): Promise<T> {
	const current = controller;
	const operation = current?.beginAuthChange();
	let result: T;
	try {
		result = await run();
	} catch (error) {
		if (operation) current?.endAuthChange(operation, 'unknown');
		throw error;
	}
	if (operation) current?.endAuthChange(operation, changed(result) ? 'changed' : 'unchanged');
	return result;
}
