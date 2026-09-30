import type { AnalyticsController } from './controller';
import { classifySession, type SessionSnapshot } from './identity';

/** The parts of a Better Auth client the controller follows. */
export interface SessionSource {
	useSession(): { subscribe(listener: (snapshot: SessionSnapshot) => void): () => void };
	$store: { atoms: Record<string, { listen(listener: () => void): () => void } | undefined> };
}

/**
 * Feeds session changes to the controller. Returns an unsubscribe function.
 *
 * Better Auth toggles `$sessionSignal` after a sign-out or impersonation change,
 * and its refresh manager answers the toggle by starting a session fetch that
 * aborts any fetch still running. Every session answer after the toggle therefore
 * belongs to the new session, which is what `sessionRequested` tells the controller.
 * The pending state alone cannot say this: the store drops a pending snapshot equal
 * to the one it already holds.
 */
export function followSession(controller: AnalyticsController, client: SessionSource): () => void {
	const stopSession = client
		.useSession()
		.subscribe((snapshot) => controller.setAuth(classifySession(snapshot)));
	const stopSignal = client.$store.atoms.$sessionSignal?.listen(() =>
		controller.sessionRequested()
	);
	return () => {
		stopSession();
		stopSignal?.();
	};
}
