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

		// The exit runs for `--think-swap`, the entrance starts `--think-gap` later
		// and runs for the same, so the exiting copy is stale from the point both
		// have finished: one swap plus one gap, not two swaps.
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
	 * release it after `--think-gap`, and never before the next frame. Releasing
	 * in the same frame lets the browser resolve both states at once and the rise
	 * never renders; releasing only on the frame ignored the gap, which is the
	 * whole point of the token: the outgoing label gets a head start so the two
	 * do not cross in the middle of the box.
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
		let frame = 0;
		const held = setTimeout(
			() => {
				frame = requestAnimationFrame(() => node.classList.remove('is-enter-start'));
			},
			motionValue('--think-gap', 50)
		);
		return {
			destroy: () => {
				clearTimeout(held);
				cancelAnimationFrame(frame);
			}
		};
	}
</script>

<!-- The visual stack is hidden from assistive technology and the label is
     carried by a separate node holding only the current text. Two reasons, both
     measured: during a swap the outgoing and incoming copies are both in the
     DOM, so a region spanning them read "Connecting Thinking"; and the shimmer
     paints through a `::before` that repeats `data-text` as generated content,
     which Chromium exposes, so each label read twice.

     `aria-live` and deliberately no `role="status"`. The status line is the
     whole content of its consumer's accordion trigger, and a `status` child
     does not contribute to name-from-content: measured in Chromium, the same
     button reads "Thought for 4 seconds" with the plain live node and is
     unnamed with the status role. -->
<span class="sr-only" aria-live="polite">{text}</span>
<span class={cn('t-think', className)} data-shimmer={shimmer ? 'true' : 'false'} aria-hidden="true">
	<span class="t-think-sizer">{sizer ?? text}</span>
	{#each lines as line (line.id)}
		<span
			class="t-think-text"
			class:is-exit={line.exiting}
			data-text={line.text}
			use:enter={line.entering}>{line.text}</span
		>
	{/each}
</span>
