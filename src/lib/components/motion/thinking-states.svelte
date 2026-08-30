<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { motionMs } from './motion-tokens.js';

	/**
	 * An AI status line that shimmers while a state holds, then swaps to the
	 * next one: the outgoing copy leaves upward through a blur while the
	 * incoming copy rises from below.
	 *
	 * Both copies are in the DOM during a swap and both are absolutely
	 * positioned, so the box would collapse without the hidden sizer that
	 * holds the longest state's width.
	 */
	let {
		states,
		class: className
	}: {
		/** Cycled in order, wrapping around. A single entry just shimmers. */
		states: string[];
		class?: string;
	} = $props();

	type Line = { id: number; text: string; entering: boolean; exiting: boolean };

	let nextId = 0;
	let index = $state(0);
	let lines = $state<Line[]>([]);

	// The sizer only reports the right width if it carries the longest state,
	// so the box never resizes mid-swap.
	const widest = $derived(
		states.reduce((longest, state) => (state.length > longest.length ? state : longest), '')
	);

	$effect(() => {
		// Restart cleanly whenever the caller swaps the state list out.
		const cycle = states;
		index = 0;
		lines = [{ id: nextId++, text: cycle[0] ?? '', entering: false, exiting: false }];
		if (cycle.length < 2) return;

		let holdTimer: ReturnType<typeof setTimeout>;
		let swapTimer: ReturnType<typeof setTimeout>;

		const tick = () => {
			const swap = motionMs('--think-swap', 150);
			const gap = motionMs('--think-gap', 50);
			index = (index + 1) % cycle.length;

			lines = [
				...lines.map((line) => ({ ...line, exiting: true })),
				{ id: nextId++, text: cycle[index] ?? '', entering: true, exiting: false }
			];

			swapTimer = setTimeout(() => {
				lines = lines.filter((line) => !line.exiting);
				holdTimer = setTimeout(tick, motionMs('--think-hold', 2000));
			}, swap + gap);
		};

		holdTimer = setTimeout(tick, motionMs('--think-hold', 2000));
		return () => {
			clearTimeout(holdTimer);
			clearTimeout(swapTimer);
		};
	});

	/**
	 * Drop `is-enter-start` one frame after the line mounts. The class is what
	 * parks the incoming copy below the box with no transition; releasing it in
	 * the same frame would let the browser collapse both states into one style
	 * resolution and the rise would never render.
	 */
	function release(node: HTMLElement) {
		const frame = requestAnimationFrame(() => node.classList.remove('is-enter-start'));
		return { destroy: () => cancelAnimationFrame(frame) };
	}
</script>

<span class={cn('t-think', className)} role="status" aria-live="polite">
	<span class="t-think-sizer" aria-hidden="true">{widest}</span>
	{#each lines as line (line.id)}
		{#if line.entering}
			<span class="t-think-text is-enter-start" data-text={line.text} use:release>{line.text}</span>
		{:else}
			<span class="t-think-text" class:is-exit={line.exiting} data-text={line.text}
				>{line.text}</span
			>
		{/if}
	{/each}
</span>
