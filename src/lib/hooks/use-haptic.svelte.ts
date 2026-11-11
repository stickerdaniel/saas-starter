import { browser } from '$app/env';
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
	// Owned timer instead of runed's useDebounce: its cancel() defers by one
	// macrotask when nothing is pending, then clears a timer armed meanwhile
	#resetTimer: ReturnType<typeof setTimeout> | undefined;

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

		clearTimeout(this.#resetTimer);
		this.#isActive = true;
		this.#resetTimer = setTimeout(() => {
			this.#isActive = false;
		}, this.#estimateDuration(input));

		engine.trigger(input as WebHapticsInput);
	}

	cancel(): void {
		this.#engine?.cancel();
		clearTimeout(this.#resetTimer);
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
// eslint-disable-next-line local/no-module-state-singleton -- SSR-safe: browser-guarded writes, see rationale above
export const haptic = new UseHaptic();
