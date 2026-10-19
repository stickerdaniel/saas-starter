// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			token: string | undefined;
			sidebarOpen: boolean;
			publicAuthSnapshot: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** The deploy recovery the inline script in src/app.html installs. */
	interface DeployRecovery {
		/**
		 * Asks `keepPage` before a failed chunk import reloads the page; returning
		 * true keeps it. Returns the matching detach.
		 */
		hold(keepPage: () => boolean): () => void;
	}

	interface Window {
		__deployRecovery: DeployRecovery;
	}
}

export {};
