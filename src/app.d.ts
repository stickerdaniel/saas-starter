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

	/** What the root layout's upload registry tells the deploy recovery in src/app.html. */
	interface DeployRecoveryGuard {
		/** Whether a file is in flight right now. Asked at the moment of departure. */
		busy(): boolean;
		/** A failed-preload reload started or stopped waiting for uploads to settle. */
		pendingChanged(pending: boolean): void;
	}

	/** The deploy-recovery coordinator the inline script in src/app.html installs. */
	interface DeployRecovery {
		/** Lets departures wait for uploads. Returns the matching detach. */
		attach(guard: DeployRecoveryGuard): () => void;
		/**
		 * Full-loads `href` after a detected deploy unless a file is in flight.
		 * Neither spends nor depends on the failed-preload attempt.
		 */
		navigate(href: string): boolean;
		/** The last upload settled: retry a waiting failed-preload reload once. */
		settle(): void;
	}

	interface Window {
		__deployRecovery: DeployRecovery;
	}
}

export {};
