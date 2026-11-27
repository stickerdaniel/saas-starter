<script lang="ts">
	import * as Popover from '#lib/components/ui/popover/index.js';
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

	let tooltipOpen = $state(false);
	let popoverOpen = $state(false);
	let clipped = $state(false);
	let touchClick = false;
	let element: HTMLElement | null = null;

	// Full text that repeats fully visible text is noise, so only clipped text may open.
	// The gate measures again when opening is requested instead of trusting the last
	// observation, so the first hover, focus or tap already sees the current layout.
	function measure() {
		clipped = !!element && element.scrollWidth > element.clientWidth;
		if (!clipped) {
			tooltipOpen = false;
			popoverOpen = false;
		}
		return clipped;
	}

	function setTooltipOpen(next: boolean) {
		tooltipOpen = next && measure();
		if (tooltipOpen) popoverOpen = false;
	}

	// Hover and keyboard focus already reach the tooltip; the popover serves touch alone.
	function setPopoverOpen(next: boolean) {
		popoverOpen = next && touchClick && measure();
		if (popoverOpen) tooltipOpen = false;
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

<Tooltip.Root bind:open={() => tooltipOpen, setTooltipOpen} disableCloseOnTriggerClick>
	<Popover.Root bind:open={() => popoverOpen, setPopoverOpen}>
		<Tooltip.Trigger>
			{#snippet child({ props: tooltipProps })}
				<Popover.Trigger {...tooltipProps}>
					{#snippet child({
						props: {
							type: _buttonType,
							'aria-describedby': _describedBy,
							'aria-haspopup': _hasPopup,
							'aria-expanded': _expanded,
							'aria-controls': _controls,
							onkeydown: _toggleOnKey,
							...props
						}
					})}
						<!-- Only clipped text becomes a tab stop, so keyboard users can reach the full
							 text. This stays passive text whose full value is already its accessible
							 content: the button type, the popup state and the description by the
							 hidden content are dropped, and Enter or Space open nothing. -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<span
							{...props}
							tabindex={clipped ? 0 : undefined}
							class={cn(
								'block min-w-0 truncate rounded-sm outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50',
								className
							)}
							data-testid={testId}
							onclickcapture={(event) =>
								(touchClick = event instanceof PointerEvent && event.pointerType === 'touch')}
							{@attach trackClip(text)}>{text}</span
						>
					{/snippet}
				</Popover.Trigger>
			{/snippet}
		</Tooltip.Trigger>
		<!-- Touch dismissal must not move focus, so the content neither traps nor takes it. -->
		<Popover.Content
			variant="tooltip"
			class="wrap-anywhere"
			aria-hidden="true"
			trapFocus={false}
			onOpenAutoFocus={(event) => event.preventDefault()}
			onCloseAutoFocus={(event) => event.preventDefault()}
			><span class="selectable">{text}</span></Popover.Content
		>
	</Popover.Root>
	<Tooltip.Content class="wrap-anywhere" aria-hidden="true"
		><span class="selectable">{text}</span></Tooltip.Content
	>
</Tooltip.Root>
