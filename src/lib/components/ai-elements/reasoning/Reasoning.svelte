<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import * as Accordion from '$lib/components/ui/accordion/index.js';

	interface Props {
		class?: string;
		open?: boolean;
		defaultOpen?: boolean;
		onOpenChange?: (open: boolean) => void;
		children?: Snippet;
	}

	let {
		class: className = '',
		open = $bindable(),
		defaultOpen = false,
		onOpenChange,
		children,
		...props
	}: Props = $props();

	const ITEM_VALUE = 'reasoning-item';

	// Set up controllable state for open
	// defaultOpen is only used to seed uncontrolled state.
	// svelte-ignore state_referenced_locally
	let isOpen = $state(open ?? defaultOpen);

	// Convert boolean open state to accordion value
	let accordionValue = $derived<string | undefined>(isOpen ? ITEM_VALUE : undefined);

	// Sync external open prop to local state
	$effect(() => {
		if (open !== undefined) {
			isOpen = open;
		}
	});

	let handleValueChange = (newValue: string | undefined) => {
		let newOpen = newValue === ITEM_VALUE;
		isOpen = newOpen;

		if (open !== undefined) {
			open = newOpen;
		}

		onOpenChange?.(newOpen);
	};
</script>

<!--
	Reasoning is an inline, chromeless accordion: no card border, radius, or open
	fill. Some shadcn accordion variants ship a card style (rounded-2xl border +
	data-open:bg-muted/50); we opt out here rather than relying on the base style,
	so a future `shadcn add accordion` (theme update) can't re-add the outline.
-->
<Accordion.Root
	type="single"
	class={cn('not-prose mb-4 rounded-none border-0', className)}
	value={accordionValue}
	onValueChange={handleValueChange}
	{...props}
>
	<Accordion.Item value={ITEM_VALUE} class="border-0 data-open:bg-transparent">
		{@render children?.()}
	</Accordion.Item>
</Accordion.Root>
