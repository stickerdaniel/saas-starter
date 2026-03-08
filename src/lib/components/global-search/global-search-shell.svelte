<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
	import { useGlobalSearchContext } from './context.svelte';

	const globalSearch = useGlobalSearchContext();

	let shouldLoadMenu = $state(false);
	let loadPromise: Promise<void> | null = null;

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;

		return (
			target.isContentEditable ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement
		);
	}

	async function ensureMenu(): Promise<void> {
		if (!loadPromise) {
			loadPromise = (async () => {
				if (!shouldLoadMenu) {
					shouldLoadMenu = true;
					await tick();
				}
			})();
		}

		await loadPromise;
	}

	$effect(() => {
		if (globalSearch.open) {
			void ensureMenu();
		}
	});

	onMount(() => {
		if (!browser) return;

		let idleId: number | null = null;
		let timeoutId: number | null = null;
		let loadListener: (() => void) | null = null;
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

		function cleanup(): void {
			for (const eventName of interactionEvents) {
				window.removeEventListener(eventName, loadOnInteraction);
			}
			window.removeEventListener('keydown', handleInitialShortcut);

			if (loadListener) {
				window.removeEventListener('load', loadListener);
				loadListener = null;
			}

			if (idleId !== null && cancelIdleCallback) {
				cancelIdleCallback(idleId);
			}

			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
		}

		function scheduleIdleLoad(): void {
			if (requestIdleCallback) {
				idleId = requestIdleCallback(
					() => {
						void ensureMenu();
						cleanup();
					},
					{ timeout: 3500 }
				);
				return;
			}

			timeoutId = window.setTimeout(() => {
				void ensureMenu();
				cleanup();
			}, 2500);
		}

		function loadOnInteraction(): void {
			void ensureMenu();
			cleanup();
		}

		function handleInitialShortcut(event: KeyboardEvent): void {
			const isShortcut =
				(event.key === 'k' && (event.metaKey || event.ctrlKey)) || event.key === '/';
			if (!isShortcut || isTypingTarget(event.target)) return;
			if (shouldLoadMenu) return;

			event.preventDefault();
			globalSearch.openMenu();
			void ensureMenu();
			cleanup();
		}

		for (const eventName of interactionEvents) {
			window.addEventListener(eventName, loadOnInteraction, { passive: true, once: true });
		}
		window.addEventListener('keydown', handleInitialShortcut);

		if (document.readyState === 'complete') {
			scheduleIdleLoad();
		} else {
			loadListener = () => {
				scheduleIdleLoad();
			};
			window.addEventListener('load', loadListener, { once: true });
		}

		return cleanup;
	});
</script>

{#if shouldLoadMenu}
	{#await import('./command-menu.svelte') then { default: CommandMenu }}
		<CommandMenu />
	{/await}
{/if}
