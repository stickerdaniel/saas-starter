<!--
  Rive Animation Attribution (CC BY 4.0)

  Animation: [ANIMATION_NAME]
  Creator: [CREATOR_NAME]
  License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
  Source: [RIVE_COMMUNITY_URL]
  Modifications: [NONE/DESCRIBE_MODIFICATIONS]

  You are free to:
  - Share and use commercially
  - Adapt and modify

  Under the terms:
  - Attribution required (provide creator credit, license link, and indicate changes)
  - No additional restrictions
-->

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { useMutationObserver } from 'runed';
	import { TAILWIND_BREAKPOINTS, useMedia } from '$lib/hooks/use-media.svelte';
	import { Spotlight } from '$lib/components/ui/spotlight/index.js';
	import type { Component } from 'svelte';

	interface RiveBackgroundProps {
		src: string;
		class?: string;
		stateMachine?: string;
		defer?: boolean;
		desktopOnly?: boolean;
	}

	let {
		src,
		class: className = '',
		stateMachine = 'Motion',
		defer = false,
		desktopOnly = false
	}: RiveBackgroundProps = $props();

	const media = useMedia(TAILWIND_BREAKPOINTS);

	let isDark = $state(false);

	// Check initial dark mode state on mount
	onMount(() => {
		isDark = document.documentElement.classList.contains('dark');
	});

	// Watch for theme class changes reactively
	useMutationObserver(
		() => document.documentElement,
		() => {
			isDark = document.documentElement.classList.contains('dark');
		},
		{ attributes: true, attributeFilter: ['class'] }
	);

	const opacity = $derived(isDark ? 1 : media.lg ? 1 : 0.3);

	let canvas = $state<HTMLCanvasElement | null>(null);
	let riveInstance: any = null;
	let isLoaded = $state(false);
	let shouldRender = $state(false);
	let FollowingPointerComponent = $state.raw<Component | null>(null);

	// Cache the base buffer at instance level to avoid re-fetching on re-renders
	let cachedBuffer: ArrayBuffer | null = null;
	let cachedSrc: string | null = null;

	onMount(() => {
		let destroyed = false;
		const abortController = new AbortController();
		let timeoutId: number | null = null;
		let idleId: number | null = null;
		let loadListener: (() => void) | null = null;
		const { requestIdleCallback, cancelIdleCallback } = window as Window & {
			requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
			cancelIdleCallback?: (id: number) => void;
		};

		async function initRive() {
			try {
				const canvasElement = canvas;
				if (!canvasElement) return;

				// Fetch the .riv file manually if not cached or src changed
				if (!cachedBuffer || cachedSrc !== src) {
					const response = await fetch(src, { signal: abortController.signal });
					if (!response.ok) throw new Error(`Failed to fetch ${src}: ${response.status}`);
					cachedBuffer = await response.arrayBuffer();
					cachedSrc = src;
				}

				if (destroyed) return;

				// Clone the buffer so each Rive instance gets a fresh, non-detached copy
				const riveBuffer = cachedBuffer.slice(0);

				const RiveModule = await import('@rive-app/canvas');
				if (destroyed) return;

				const Rive = RiveModule.Rive || (RiveModule as any).default || RiveModule;

				riveInstance = new Rive({
					buffer: riveBuffer,
					canvas: canvasElement,
					autoplay: true,
					stateMachines: stateMachine,
					onLoad: () => {
						if (destroyed) return;
						riveInstance?.resizeDrawingSurfaceToCanvas();
						isLoaded = true;
					},
					onLoadError: (error: any) => {
						if (destroyed) return;
						console.error('Error loading Rive file:', error);
						isLoaded = true; // Fade out even on error to show content
					}
				});
			} catch (error) {
				if (destroyed) return;
				if ((error as Error).name === 'AbortError') return;
				console.error('Error initializing Rive:', error);
				isLoaded = true; // Fade out even on error to show content
			}
		}

		async function startRive() {
			if (destroyed || riveInstance || shouldRender) return;

			if (!FollowingPointerComponent) {
				const mod = await import('$lib/components/ui/FollowingPointer/FollowingPointer.svelte');
				if (destroyed) return;
				FollowingPointerComponent = mod.default;
			}

			shouldRender = true;
			await tick();
			if (destroyed) return;

			await initRive();
		}

		const isDesktop = window.matchMedia(`(min-width: ${TAILWIND_BREAKPOINTS.lg})`).matches;
		if (desktopOnly && !isDesktop) {
			isLoaded = true;
			return;
		}

		function scheduleStart(): void {
			if (destroyed) return;

			if (requestIdleCallback) {
				idleId = requestIdleCallback(() => {
					void startRive();
				});
				return;
			}

			timeoutId = window.setTimeout(() => {
				void startRive();
			}, 10000);
		}

		if (!defer) {
			void startRive();
		} else if (document.readyState === 'complete') {
			scheduleStart();
		} else {
			loadListener = () => {
				scheduleStart();
			};
			window.addEventListener('load', loadListener, { once: true });
		}

		return () => {
			destroyed = true;
			abortController.abort();
			if (loadListener) {
				window.removeEventListener('load', loadListener);
			}
			if (idleId !== null && cancelIdleCallback) {
				cancelIdleCallback(idleId);
			}
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
			riveInstance?.cleanup();
		};
	});
</script>

<div class={className}>
	{#if shouldRender && FollowingPointerComponent}
		<FollowingPointerComponent class="h-full w-full">
			{#snippet title()}
				<p class="text-xs">Rive animation by JcToon</p>
			{/snippet}

			<div class="h-full w-full" style="opacity: {opacity};">
				<!-- Spotlight for dark mode -->
				{#if isDark && isLoaded}
					<Spotlight class="-top-50 right-[-285%] -z-5 lg:-top-72" fill="white" />
				{/if}

				<!-- Rive Canvas -->
				<canvas
					bind:this={canvas}
					class="pointer-events-none absolute -z-3 h-full w-full"
					style="mix-blend-mode: multiply;"
					tabindex="-1"
				></canvas>

				<!-- Canvas Cover (Fade in Effect) -->
				<div
					class="pointer-events-none absolute inset-0 -z-2 bg-background transition-opacity duration-1000 ease-out"
					style="opacity: {isLoaded ? 0 : 1};"
				></div>

				<!-- Cloud Fade Effect for light mode -->
				{#if !isDark}
					<div
						class="pointer-events-none absolute -z-1 transition-all duration-1500 ease-out"
						style="inset: -100%; background: radial-gradient(circle at center, transparent 0%, transparent 20%, rgba(255, 255, 255, 0.95) 35%, rgba(255, 255, 255, 1) 45%); transform: scale({isLoaded
							? 1
							: 0.35}); pointer-events: none;"
					></div>
				{/if}
			</div>
		</FollowingPointerComponent>
	{/if}
</div>
