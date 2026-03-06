import { browser } from '$app/environment';
import { MediaQuery } from 'svelte/reactivity';
import type { ActionReturn } from 'svelte/action';
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
	#activeTimeout: ReturnType<typeof setTimeout> | undefined;

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

		if (this.#activeTimeout) clearTimeout(this.#activeTimeout);
		this.#isActive = true;

		const duration = this.#estimateDuration(input);
		this.#activeTimeout = setTimeout(() => {
			this.#isActive = false;
		}, duration);

		engine.trigger(input as WebHapticsInput);
	}

	cancel(): void {
		this.#engine?.cancel();
		if (this.#activeTimeout) clearTimeout(this.#activeTimeout);
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

export const haptic = new UseHaptic();

export function hapticAction(
	node: HTMLElement,
	param: HapticPreset | { pattern: HapticPreset; event?: string }
): ActionReturn<HapticPreset | { pattern: HapticPreset; event?: string }> {
	let pattern: HapticPreset = typeof param === 'string' ? param : param.pattern;
	let eventName: string = typeof param === 'string' ? 'click' : (param.event ?? 'click');

	function resolve(p: typeof param) {
		if (typeof p === 'string') {
			pattern = p;
			eventName = 'click';
		} else {
			pattern = p.pattern;
			eventName = p.event ?? 'click';
		}
	}

	function handler() {
		haptic.trigger(pattern);
	}

	node.addEventListener(eventName, handler);

	return {
		update(newParam) {
			node.removeEventListener(eventName, handler);
			resolve(newParam);
			node.addEventListener(eventName, handler);
		},
		destroy() {
			node.removeEventListener(eventName, handler);
		}
	};
}
