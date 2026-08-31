<script lang="ts">
	import { untrack } from 'svelte';
	import { cn } from '$lib/utils.js';
	import { motionValue } from './motion-tokens.js';

	/**
	 * An AI status line. It shimmers while a state holds, and when the state
	 * changes the outgoing line leaves upward through a blur while the incoming
	 * one rises from below, so a narration like
	 * "Connecting…" → "Thinking…" → "Thought for 4 seconds" reads as one moving
	 * line rather than three hard cuts.
	 *
	 * Both copies are in the DOM during a swap and both are absolutely
	 * positioned, so the box would collapse without the hidden sizer.
	 */
	let {
		text,
		sizer,
		shimmer = true,
		class: className
	}: {
		text: string;
		/**
		 * What the box is sized against. Defaults to the live text, so the line
		 * hugs whatever state is showing. Pass the widest label the line can hold
		 * to keep the box from resizing between states instead.
		 */
		sizer?: string;
		/** Turn off once the work is done and the line is reporting a result. */
		shimmer?: boolean;
		class?: string;
	} = $props();

	type Line = { id: number; text: string; entering: boolean; exiting: boolean };

	let nextId = 1;
	// The first line is the mount value, not a reactive read: later values arrive
	// through the effect below, which has to know the previous one to animate it out.
	const initial = untrack(() => text);
	let shown = initial;
	let lines = $state<Line[]>([{ id: 0, text: initial, entering: false, exiting: false }]);

	$effect(() => {
		const next = text;
		if (next === shown) return;
		shown = next;

		lines = [
			...untrack(() => lines).map((line) => ({ ...line, exiting: true })),
			{ id: nextId++, text: next, entering: true, exiting: false }
		];

		// Outgoing and incoming animate together, so one swap costs one
		// `--think-swap` plus the gap that holds the entrance back, not two.
		const settle = setTimeout(
			() => {
				lines = untrack(() => lines).filter((line) => !line.exiting);
			},
			motionValue('--think-swap', 150) + motionValue('--think-gap', 50)
		);
		return () => clearTimeout(settle);
	});

	/**
	 * Park an incoming line below the box with its transition switched off, then
	 * release it one frame later. Releasing in the same frame lets the browser
	 * resolve both states at once and the rise never renders.
	 *
	 * The start class is written from here rather than in the markup because the
	 * same line has to be able to exit later. Selecting the markup on `entering`
	 * put an already-entered line in the entrance branch forever, so from the
	 * second swap on the outgoing label never got `is-exit`: it stayed put under
	 * the incoming one and then vanished when the settle timer removed it.
	 */
	function enter(node: HTMLElement, active: boolean) {
		if (!active) return;
		node.classList.add('is-enter-start');
		const frame = requestAnimationFrame(() => node.classList.remove('is-enter-start'));
		return { destroy: () => cancelAnimationFrame(frame) };
	}
</script>

<span
	class={cn('t-think', className)}
	data-shimmer={shimmer ? 'true' : 'false'}
	role="status"
	aria-live="polite"
>
	<span class="t-think-sizer" aria-hidden="true">{sizer ?? text}</span>
	{#each lines as line (line.id)}
		<span
			class="t-think-text"
			class:is-exit={line.exiting}
			data-text={line.text}
			use:enter={line.entering}>{line.text}</span
		>
	{/each}
</span>
