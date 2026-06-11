import { browser } from '$app/environment';
import { useDebounce } from 'runed';
import { MediaQuery } from 'svelte/reactivity';
import type { defaultPatterns, HapticInput as WebHapticsInput, WebHaptics } from 'web-haptics';

export type HapticPreset = keyof typeof defaultPatterns;
export type HapticInput = HapticPreset | number | number[];

let WebHapticsClass: typeof WebHaptics | undefined;
if (browser) {
	import('web-haptics').then((m) => {
		WebHapticsClass = m.WebHaptics;
	});
}

export class UseHaptic {
	#debug = $state(false);
	#isActive = $state(false);
	#engine: WebHaptics | null = null;
	#reducedMotion: MediaQuery | null = null;
	// Reactive so useDebounce's wait getter picks up the per-trigger duration
	#lastDuration = $state(100);
	#resetActive = useDebounce(
		() => {
			this.#isActive = false;
		},
		() => this.#lastDuration
	);

	constructor(options?: { debug?: boolean }) {
		this.#debug = options?.debug ?? false;
		if (browser) {
			this.#reducedMotion = new MediaQuery('prefers-reduced-motion: reduce');
		}
	}

	get isSupported(): boolean {
		return browser && typeof navigator !== 'undefined' && 'vibrate' in navigator;
	}

	get isActive(): boolean {
		return this.#isActive;
	}

	get prefersReducedMotion(): boolean {
		return this.#reducedMotion?.current ?? false;
	}

	get debug(): boolean {
		return this.#debug;
	}

	set debug(value: boolean) {
		this.#debug = value;
		this.#engine?.setDebug(value);
	}

	trigger(input?: HapticInput): void {
		if (!browser || this.prefersReducedMotion) return;

		const engine = this.#ensureEngine();
		if (!engine) return;

		this.#resetActive.cancel();
		this.#isActive = true;

		this.#lastDuration = this.#estimateDuration(input);
		void this.#resetActive().catch(() => {});

		engine.trigger(input as WebHapticsInput);
	}

	cancel(): void {
		this.#engine?.cancel();
		this.#resetActive.cancel();
		this.#isActive = false;
	}

	destroy(): void {
		this.cancel();
		this.#engine?.destroy();
		this.#engine = null;
	}

	#ensureEngine(): WebHaptics | null {
		if (!browser || !WebHapticsClass) return null;
		if (this.#engine) return this.#engine;
		this.#engine = new WebHapticsClass({ debug: this.#debug });
		return this.#engine;
	}

	#estimateDuration(input?: HapticInput): number {
		if (input === undefined || typeof input === 'string') return 100;
		if (typeof input === 'number') return input;
		if (Array.isArray(input)) return input.reduce((sum, n) => sum + n, 0);
		return 100;
	}
}

// Intentional module-scope singleton: SSR-safe because every write of
// caller-controlled data (trigger) is browser-guarded; the remaining writes
// (constructor default, debug setter, cancel) set constants with no
// per-request data, and no field is rendered into SSR HTML, so nothing can
// leak across requests. Kept as a singleton (instead of context) for
// ergonomic imports across its many call sites.
export const haptic = new UseHaptic();
