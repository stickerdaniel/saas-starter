<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const tabsListVariants = tv({
		base: 'relative rounded-lg p-[3px] group-data-horizontal/tabs:h-9 data-[variant=line]:rounded-none group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col',
		variants: {
			variant: {
				default: 'cn-tabs-list-variant-default bg-muted',
				line: 'cn-tabs-list-variant-line gap-1 bg-transparent'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type TabsListVariant = VariantProps<typeof tabsListVariants>['variant'];
</script>

<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		variant = 'default',
		class: className,
		children,
		...restProps
	}: TabsPrimitive.ListProps & {
		variant?: TabsListVariant;
	} = $props();

	let thumbEl = $state<HTMLSpanElement | null>(null);

	// Slide an active-pill "thumb" between triggers: JS measures the active
	// trigger and writes its offset/size onto the thumb inline, CSS owns the
	// tween. Until the thumb has measured, the active trigger paints its own
	// background as an SSR/pre-hydration fallback, switched off via the
	// data-thumb-ready gate in tabs-trigger.svelte once the thumb takes over.
	$effect(() => {
		const list = ref;
		const thumb = thumbEl;
		if (!list || !thumb) return;
		// No current vertical usage; leave the per-trigger active styles for it.
		if (list.getAttribute('data-orientation') !== 'horizontal') return;

		const isLine = variant === 'line';

		function moveThumb(animate: boolean) {
			if (!list || !thumb) return;
			const active = list.querySelector<HTMLElement>(
				'[data-slot="tabs-trigger"][data-state="active"]'
			);
			if (!active) {
				thumb.style.opacity = '0';
				return;
			}

			const write = () => {
				if (isLine) {
					thumb.style.transform = `translateX(${active.offsetLeft}px)`;
					thumb.style.width = `${active.offsetWidth}px`;
				} else {
					thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
					thumb.style.width = `${active.offsetWidth}px`;
					thumb.style.height = `${active.offsetHeight}px`;
				}
				thumb.style.opacity = '1';
			};

			if (animate) {
				write();
			} else {
				// Snap without a tween: suspend the transition, force a reflow, restore.
				const prev = thumb.style.transition;
				thumb.style.transition = 'none';
				write();
				void thumb.offsetWidth;
				thumb.style.transition = prev;
			}

			list.setAttribute('data-thumb-ready', '');
		}

		// Snap to the initial active trigger after first layout, no animation.
		const raf = requestAnimationFrame(() => moveThumb(false));

		// data-state flips on any value change (click, URL, back/forward).
		const mo = new MutationObserver(() => moveThumb(true));
		mo.observe(list, { subtree: true, attributeFilter: ['data-state'] });

		// Re-measure on layout/size changes without animating. Observe the list
		// and every trigger: in a w-full list a label swap (e.g. a language
		// change) resizes a trigger and shifts offsets without resizing the list,
		// which a list-only observation would miss.
		const ro = new ResizeObserver(() => moveThumb(false));
		ro.observe(list);
		list.querySelectorAll('[data-slot="tabs-trigger"]').forEach((trigger) => ro.observe(trigger));

		return () => {
			cancelAnimationFrame(raf);
			mo.disconnect();
			ro.disconnect();
			list.removeAttribute('data-thumb-ready');
		};
	});

	const thumbClass = $derived(
		cn(
			'pointer-events-none absolute top-0 left-0 z-0 opacity-0 transition-[transform,width,height] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] motion-reduce:transition-none',
			variant === 'line'
				? 'top-auto bottom-0 h-0.5 bg-foreground transition-[transform,width]'
				: 'rounded-md border border-transparent bg-background shadow-sm dark:border-input dark:bg-input/30'
		)
	);
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	data-variant={variant}
	class={cn(tabsListVariants({ variant }), className)}
	{...restProps}
>
	<span bind:this={thumbEl} aria-hidden="true" data-slot="tabs-thumb" class={thumbClass}></span>
	{@render children?.()}
</TabsPrimitive.List>
