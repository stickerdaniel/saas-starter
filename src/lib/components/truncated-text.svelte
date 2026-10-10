<script lang="ts">
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { cn } from '#lib/utils.js';

	let {
		text,
		class: className,
		testId
	}: {
		text: string;
		class?: string;
		testId?: string;
	} = $props();

	let open = $state(false);
	let clipped = $state(false);
	let touch = $state(false);
	let element: HTMLElement | null = null;

	// A tooltip that repeats fully visible text is noise, so only clipped text may open
	// one. The gate measures again when opening is requested instead of trusting the
	// last observation, so the first hover or focus already sees the current layout.
	function measure() {
		clipped = !!element && element.scrollWidth > element.clientWidth;
		if (!clipped) open = false;
		return clipped;
	}

	function setOpen(next: boolean) {
		open = next && measure();
	}

	function trackClip(_text: string) {
		return (node: HTMLElement) => {
			let disposed = false;
			element = node;
			const remeasure = () => {
				if (!disposed) measure();
			};

			remeasure();
			// A fallback font measures differently than the loaded one, and a later font
			// load changes the text width without resizing the clamped element.
			const fonts = node.ownerDocument.fonts;
			fonts?.ready.then(remeasure);
			fonts?.addEventListener('loadingdone', remeasure);
			const resizeObserver = new ResizeObserver(remeasure);
			resizeObserver.observe(node);

			return () => {
				disposed = true;
				if (element === node) element = null;
				fonts?.removeEventListener('loadingdone', remeasure);
				resizeObserver.disconnect();
			};
		};
	}
</script>

<!-- Touch ends with pointerleave, not a hover exit. Disable hover tracking for
	 touch and cancel only that leave; focus and intentional dismissal still apply. -->
<Tooltip.Root
	bind:open={() => open, setOpen}
	disableCloseOnTriggerClick
	disableHoverableContent={touch}
>
	<Tooltip.Trigger onpointerenter={(event) => (touch = event.pointerType === 'touch')}>
		{#snippet child({ props: { type: _buttonType, ...props } })}
			<!-- Only clipped text becomes a tab stop, so keyboard users can reach the full
				 text. The trigger props describe the element by the tooltip content and
				 type it as a button; this stays passive text whose full value is already
				 its accessible content, so both are dropped and the content is hidden. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<span
				{...props}
				onpointerleave={(event) => {
					if (event.pointerType !== 'touch' && typeof props.onpointerleave === 'function') {
						props.onpointerleave(event);
					}
				}}
				aria-describedby={undefined}
				tabindex={clipped ? 0 : undefined}
				class={cn(
					'block min-w-0 truncate rounded-sm outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50',
					className
				)}
				data-testid={testId}
				{@attach trackClip(text)}>{text}</span
			>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content class="wrap-anywhere" aria-hidden="true">{text}</Tooltip.Content>
</Tooltip.Root>
