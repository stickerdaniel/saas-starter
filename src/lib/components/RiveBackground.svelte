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
	import { onMount } from 'svelte';
	import { TAILWIND_BREAKPOINTS, useMedia } from '$lib/hooks/use-media.svelte';
	import FollowingPointer from '$lib/components/ui/FollowingPointer/FollowingPointer.svelte';

	interface RiveBackgroundProps {
		src: string;
		className?: string;
		stateMachine?: string;
	}

	let { src, className = '', stateMachine = 'Motion' }: RiveBackgroundProps = $props();

	const media = useMedia(TAILWIND_BREAKPOINTS);

	let isDark = $state(false);

	onMount(() => {
		// Check if dark mode is active
		isDark = document.documentElement.classList.contains('dark');

		// Watch for theme changes
		const observer = new MutationObserver(() => {
			isDark = document.documentElement.classList.contains('dark');
		});

		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});

		return () => observer.disconnect();
	});

	const opacity = $derived(isDark ? 1 : media.lg ? 1 : 0.3);

	let canvas: HTMLCanvasElement;
	let riveInstance: any = $state(null);
	let isLoaded = $state(false);

	// Cache the base buffer at instance level to avoid re-fetching on re-renders
	let cachedBuffer: ArrayBuffer | null = null;
	let cachedSrc: string | null = null;

	onMount(() => {
		let destroyed = false;
		const abortController = new AbortController();

		async function initRive() {
			try {
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
					canvas,
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

		initRive();

		return () => {
			destroyed = true;
			abortController.abort();
			riveInstance?.cleanup();
		};
	});
</script>

<div class={className}>
	<FollowingPointer className="h-full w-full">
		{#snippet title()}
			<p class="text-xs">Rive animation by JcToon</p>
		{/snippet}

		<div class="h-full w-full" style="opacity: {opacity};">
			<!-- Spotlight for dark mode -->
			{#if isDark}
				<!-- Spotlight 1 (soft) -->
				<div
					class="lg:h-450px] pointer-events-none absolute top-1/2 left-1/2 -z-5 h-[360px] w-[360px] blur-xl transition-transform duration-1000 ease-out lg:w-[450px] {isLoaded
						? 'animate-[breathe_5s_ease-in-out_infinite_1s]'
						: ''}"
					style="background: radial-gradient(circle at center, rgba(255, 255, 255, 1) 20%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0) 80%); will-change: opacity, transform; opacity: {isLoaded
						? 1
						: 0}; transform: translate(-50%, -50%) scale({isLoaded ? 1 : 0.7});"
				></div>
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
	</FollowingPointer>
</div>

<style>
	:global {
		@keyframes breathe {
			0%,
			100% {
				transform: translate(-50%, -50%) scale(1);
			}
			50% {
				transform: translate(-50%, -50%) scale(0.95);
			}
		}
	}
</style>
