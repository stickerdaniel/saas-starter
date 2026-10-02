import { createContext } from 'svelte';
import type { AnalyticsController, AnalyticsState } from './controller';

/**
 * Per-request view of the consent state for the banner, the footer link and the
 * settings card. The root layout creates it; `analytics-root.svelte` attaches the
 * browser controller after mount. Until then, and during SSR, analytics reads as
 * disabled and nothing renders.
 */
export class AnalyticsPreferences {
	state = $state<AnalyticsState>({ enabled: false, status: 'pending', bannerOpen: false });
	#controller: AnalyticsController | undefined;

	attach(controller: AnalyticsController): () => void {
		this.#controller = controller;
		const unsubscribe = controller.subscribe((next) => {
			this.state = next;
		});
		return () => {
			unsubscribe();
			this.#controller = undefined;
		};
	}

	/** Returns false when the choice could not be stored in this browser. */
	allow(): boolean {
		return this.#controller?.grant() ?? false;
	}

	/** Returns false when the choice could not be stored; analytics is still off here. */
	decline(): boolean {
		return this.#controller?.deny() ?? false;
	}

	open(): void {
		this.#controller?.openPreferences();
	}

	close(): void {
		this.#controller?.closePreferences();
	}
}

const [get, set] = createContext<AnalyticsPreferences>();
export const analyticsPreferencesContext = { get, set };
