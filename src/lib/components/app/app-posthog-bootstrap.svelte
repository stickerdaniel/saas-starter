<script lang="ts">
	import { onMount } from 'svelte';
	import { PUBLIC_POSTHOG_API_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';
	import { initPosthog } from '$lib/analytics/posthog';

	onMount(function onMountPosthogInit() {
		if (!PUBLIC_POSTHOG_API_KEY || !PUBLIC_POSTHOG_HOST) return;

		let initialized = false;
		let timeoutId: number | null = null;
		let idleId: number | null = null;
		const { requestIdleCallback, cancelIdleCallback } = window as Window & {
			requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
			cancelIdleCallback?: (id: number) => void;
		};

		const interactionEvents: Array<keyof WindowEventMap> = [
			'pointerdown',
			'keydown',
			'scroll',
			'touchstart'
		];

		function initOnce(): void {
			if (initialized) return;
			initialized = true;
			initPosthog();
			cleanup();
		}

		function onUserInteraction(): void {
			initOnce();
		}

		function cleanup(): void {
			for (const eventName of interactionEvents) {
				window.removeEventListener(eventName, onUserInteraction);
			}

			if (idleId !== null && cancelIdleCallback) {
				cancelIdleCallback(idleId);
			}

			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
		}

		for (const eventName of interactionEvents) {
			window.addEventListener(eventName, onUserInteraction, { passive: true, once: true });
		}

		if (requestIdleCallback) {
			idleId = requestIdleCallback(initOnce, { timeout: 3000 });
		} else {
			timeoutId = window.setTimeout(initOnce, 3000);
		}

		return cleanup;
	});
</script>
