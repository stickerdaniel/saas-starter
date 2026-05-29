<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type MarqueeDirection = 'left' | 'right' | 'up' | 'down';

	interface MarqueeProps extends HTMLAttributes<HTMLDivElement> {
		children: Snippet;
		class?: string;
		duration?: number;
		pauseOnHover?: boolean;
		direction?: MarqueeDirection;
		fade?: boolean;
		fadeAmount?: number;
		/**
		 * How many copies of the children to render inside each segment of
		 * the loop. The marquee stays seamless only when one segment fully
		 * spans its container along the scroll axis; with short content in
		 * a long container the loop exposes empty space at the seam.
		 *
		 * Pick the smallest N such that N copies of one rendered child
		 * (including any internal gaps) span the container along the
		 * direction axis. A safe estimate is
		 * `Math.ceil(containerSize / oneCopySize) + 1`.
		 *
		 * Total rendered copies of `children` = `2 * repeat` (every segment
		 * is rendered twice for the loop), so keep this as low as needed.
		 * Defaults to `1`, which is correct when one copy already spans the
		 * container. Values are clamped to the range `[1, 100]`.
		 *
		 * Only the first rendered copy is exposed to assistive tech; the
		 * remaining copies are hidden via `aria-hidden` and `inert` so
		 * screen readers and keyboard navigation see the content once.
		 *
		 * @example
		 * // short pills in a wide row: 1 copy is ~120px, container ~900px
		 * <Marquee repeat={9}>
		 *   {#snippet children()}
		 *     <span class="pill">Launch</span>
		 *     <span class="pill">Updates</span>
		 *   {/snippet}
		 * </Marquee>
		 */
		repeat?: number;
	}

	let {
		children,
		class: className,
		style: styleAttribute,
		duration = 20,
		pauseOnHover = false,
		direction = 'left',
		fade = true,
		fadeAmount = 10,
		repeat = 1,
		...props
	}: MarqueeProps = $props();

	const isVertical = $derived(direction === 'up' || direction === 'down');
	const safeDuration = $derived.by(() => {
		const n = Number(duration);
		return Number.isFinite(n) ? Math.max(n, 0.01) : 20;
	});
	const clampedFadeAmount = $derived.by(() => {
		const n = Number(fadeAmount);
		return Number.isFinite(n) ? Math.min(Math.max(n, 0), 50) : 10;
	});
	const MAX_REPEAT = 100;
	const safeRepeat = $derived.by(() => {
		const n = Number(repeat);
		return Number.isFinite(n) ? Math.min(MAX_REPEAT, Math.max(1, Math.floor(n))) : 1;
	});

	const maskImage = $derived.by(() => {
		if (!fade) {
			return '';
		}

		const start = clampedFadeAmount;
		const end = 100 - clampedFadeAmount;

		return isVertical
			? `linear-gradient(to bottom, transparent 0%, black ${start}%, black ${end}%, transparent 100%)`
			: `linear-gradient(to right, transparent 0%, black ${start}%, black ${end}%, transparent 100%)`;
	});

	const containerStyle = $derived.by(() => {
		const styles: string[] = [];

		if (styleAttribute) {
			styles.push(String(styleAttribute));
		}

		if (maskImage) {
			styles.push(`mask-image: ${maskImage}`);
			styles.push(`-webkit-mask-image: ${maskImage}`);
		}

		return styles.join('; ');
	});
</script>

<div
	{...props}
	class={cn('group flex w-full overflow-hidden', isVertical && 'flex-col', className)}
	style={containerStyle}
>
	<div
		class={cn(
			'spell-marquee__scroller',
			isVertical ? 'spell-marquee__scroller--vertical' : 'spell-marquee__scroller--horizontal',
			`spell-marquee__scroller--${direction}`,
			pauseOnHover && 'spell-marquee__scroller--pause-on-hover'
		)}
		style={`--spell-marquee-duration: ${safeDuration}s;`}
	>
		<div
			class={cn(
				'spell-marquee__segment',
				isVertical ? 'spell-marquee__segment--vertical' : 'spell-marquee__segment--horizontal'
			)}
		>
			{#each { length: safeRepeat } as _, i (i)}
				{#if i === 0}
					{@render children()}
				{:else}
					<!-- Repeated copies fill the segment visually but must stay
					     invisible to assistive tech and unreachable by keyboard.
					     display:contents keeps the flex layout identical to copy 0. -->
					<div style="display: contents" aria-hidden="true" inert>
						{@render children()}
					</div>
				{/if}
			{/each}
		</div>

		<div
			aria-hidden="true"
			inert
			class={cn(
				'spell-marquee__segment spell-marquee__segment--duplicate',
				isVertical ? 'spell-marquee__segment--vertical' : 'spell-marquee__segment--horizontal'
			)}
		>
			{#each { length: safeRepeat } as _, i (i)}
				{@render children()}
			{/each}
		</div>
	</div>
</div>

<style>
	@keyframes spell-marquee-scroll-x {
		from {
			transform: translateX(0);
		}

		to {
			transform: translateX(-50%);
		}
	}

	@keyframes spell-marquee-scroll-x-reverse {
		from {
			transform: translateX(-50%);
		}

		to {
			transform: translateX(0);
		}
	}

	@keyframes spell-marquee-scroll-y {
		from {
			transform: translateY(0);
		}

		to {
			transform: translateY(-50%);
		}
	}

	@keyframes spell-marquee-scroll-y-reverse {
		from {
			transform: translateY(-50%);
		}

		to {
			transform: translateY(0);
		}
	}

	.spell-marquee__scroller {
		display: flex;
		flex-shrink: 0;
		animation-duration: var(--spell-marquee-duration);
		animation-timing-function: linear;
		animation-iteration-count: infinite;
		will-change: transform;
	}

	.spell-marquee__scroller--horizontal {
		flex-direction: row;
		width: max-content;
	}

	.spell-marquee__scroller--vertical {
		flex-direction: column;
		width: 100%;
		height: max-content;
	}

	.spell-marquee__scroller--left {
		animation-name: spell-marquee-scroll-x;
	}

	.spell-marquee__scroller--right {
		animation-name: spell-marquee-scroll-x-reverse;
	}

	.spell-marquee__scroller--up {
		animation-name: spell-marquee-scroll-y;
	}

	.spell-marquee__scroller--down {
		animation-name: spell-marquee-scroll-y-reverse;
	}

	.group:hover .spell-marquee__scroller--pause-on-hover,
	.group:focus-within .spell-marquee__scroller--pause-on-hover {
		animation-play-state: paused;
	}

	.spell-marquee__segment {
		display: flex;
		flex-shrink: 0;
	}

	.spell-marquee__segment--horizontal {
		flex-direction: row;
		align-items: center;
	}

	.spell-marquee__segment--vertical {
		flex-direction: column;
		width: 100%;
	}

	@media (prefers-reduced-motion: reduce) {
		.spell-marquee__scroller {
			animation: none;
		}

		.spell-marquee__segment--duplicate {
			display: none;
		}
	}
</style>
