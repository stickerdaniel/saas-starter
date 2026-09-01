<script lang="ts">
	import { cn } from '$lib/utils.js';

	/**
	 * The trailing chevron of a "Learn more" style control. On hover it slides
	 * along the reading direction and its two arms spread apart into an arrow.
	 * Fine-pointer hover and keyboard focus drive the same decorative state.
	 *
	 * Drawn as two separate strokes rather than one polyline because the arms
	 * have to rotate independently about the apex at (10, 8). Purely decorative:
	 * the motion conveys no state, so coarse pointers keep the resting shape.
	 * Requires `t-learn` on the interactive ancestor.
	 */
	let { class: className }: { class?: string } = $props();
</script>

<svg
	class={cn('t-learn-chevron', className)}
	width="16"
	height="16"
	viewBox="0 0 16 16"
	fill="none"
	aria-hidden="true"
>
	<path
		class="t-learn-arm t-learn-arm-top"
		d="M6 4L10 8"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
	<path
		class="t-learn-arm t-learn-arm-bot"
		d="M10 8L6 12"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
</svg>
