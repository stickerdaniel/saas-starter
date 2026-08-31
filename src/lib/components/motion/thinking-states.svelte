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
	 * Drop `is-enter-start` one frame after the line mounts. That class parks the
	 * incoming copy below the box with its transition switched off; releasing it
	 * in the same frame would let the browser resolve both states at once and the
	 * rise would never render.
	 */
	function release(node: HTMLElement) {
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
		{#if line.entering}
			<span class="t-think-text is-enter-start" data-text={line.text} use:release>{line.text}</span>
		{:else}
			<span class="t-think-text" class:is-exit={line.exiting} data-text={line.text}
				>{line.text}</span
			>
		{/if}
	{/each}
</span>
