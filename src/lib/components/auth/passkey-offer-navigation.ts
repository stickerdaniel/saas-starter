import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

/**
 * A validated destination as an href. resolve() reads its whole argument as a route and
 * rewrites slashes inside the query and hash, so only the path goes through it.
 */
export function destinationHref(destination: string): string {
	const url = new URL(destination, 'http://destination.invalid');
	return resolve(url.pathname) + url.search + url.hash;
}

/** Leaves a passkey offer for the destination, without keeping the offer in the history. */
export function skipToDestination(destination: string): void {
	window.location.replace(destinationHref(destination));
}

/**
 * Moves on once a passkey was added. A client-side move keeps the root toaster, and its
 * confirmation, on screen. The auth data reloads because the page showing the offer may
 * have rendered before the visitor signed in.
 */
export function continueAfterEnrollment(destination: string): Promise<void> {
	// eslint-disable-next-line svelte/no-navigation-without-resolve -- destinationHref resolves its path
	return goto(destinationHref(destination), { replace: true, invalidate: ['app:auth'] });
}
