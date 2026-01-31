<script lang="ts">
	import { cn } from '$lib/utils';
	import * as Accordion from '$lib/components/ui/accordion/index.js';

	interface Props {
		class?: string;
		open?: boolean;
		defaultOpen?: boolean;
		onOpenChange?: (open: boolean) => void;
		children?: import('svelte').Snippet;
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

<Accordion.Root
	type="single"
	class={cn('not-prose mb-4', className)}
	value={accordionValue}
	onValueChange={handleValueChange}
	{...props}
>
	<Accordion.Item value={ITEM_VALUE} class="border-0">
		{@render children?.()}
	</Accordion.Item>
</Accordion.Root>
