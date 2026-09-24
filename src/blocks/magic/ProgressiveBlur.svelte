<script lang="ts">
	import { cn } from '$lib/utils.js';

	export const GRADIENT_ANGLES = {
		top: 0,
		right: 90,
		bottom: 180,
		left: 270
	};

	type ProgressiveBlurProps = {
		direction?: keyof typeof GRADIENT_ANGLES;
		blurLayers?: number;
		class?: string;
		blurIntensity?: number;
	};

	let {
		direction = 'bottom',
		blurLayers = 8,
		class: _class = '',
		blurIntensity = 0.25
	}: ProgressiveBlurProps = $props();

	let layers = $derived(Math.max(blurLayers, 2));
	let segmentSize = $derived(1 / (blurLayers + 1));
</script>

<div class={cn('relative', _class)}>
	{#each { length: layers } as _, index (index)}
		<div
			class="progressive-blur-layer pointer-events-none absolute inset-0 z-(--blur-z) rounded-[inherit] backdrop-blur-(--blur-radius)"
			style:--blur-angle="{GRADIENT_ANGLES[direction]}deg"
			style:--blur-stop-0="{index * segmentSize * 100}%"
			style:--blur-stop-1="{(index + 1) * segmentSize * 100}%"
			style:--blur-stop-2="{(index + 2) * segmentSize * 100}%"
			style:--blur-stop-3="{(index + 3) * segmentSize * 100}%"
			style:--blur-radius="{index * blurIntensity}px"
			style:--blur-z={index * 10}
		></div>
	{/each}
</div>

<style>
	/* Each layer shows its blur only across a band of the gradient: transparent,
	   opaque, opaque, transparent at the four runtime stops. */
	.progressive-blur-layer {
		mask-image: linear-gradient(
			var(--blur-angle),
			rgba(255, 255, 255, 0) var(--blur-stop-0),
			rgba(255, 255, 255, 1) var(--blur-stop-1),
			rgba(255, 255, 255, 1) var(--blur-stop-2),
			rgba(255, 255, 255, 0) var(--blur-stop-3)
		);
		-webkit-mask-image: linear-gradient(
			var(--blur-angle),
			rgba(255, 255, 255, 0) var(--blur-stop-0),
			rgba(255, 255, 255, 1) var(--blur-stop-1),
			rgba(255, 255, 255, 1) var(--blur-stop-2),
			rgba(255, 255, 255, 0) var(--blur-stop-3)
		);
	}
</style>
