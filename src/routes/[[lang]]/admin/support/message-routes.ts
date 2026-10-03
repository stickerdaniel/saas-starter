import { normalizeSupportPageRoute } from '$lib/shared/support-page-route';

/**
 * The route a support message was sent from, when the thread's own route does
 * not already answer for it.
 *
 * A support thread carries the pageUrl captured before its first message.
 * Repeating that route under every message would bury the later routes it
 * cannot account for, which are the ones worth a line of their own.
 */
export function messageRouteToShow(
	messageId: string,
	routes: Map<string, string>,
	threadPageUrl: string | undefined
): string | undefined {
	const route = normalizeSupportPageRoute(routes.get(messageId));
	const threadRoute = normalizeSupportPageRoute(threadPageUrl);
	return route && route !== threadRoute ? route : undefined;
}
