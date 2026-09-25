<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { cn } from '$lib/utils.js';
	import type { ComponentProps } from 'svelte';

	type Props = Omit<ComponentProps<typeof DropdownMenu.Item>, 'variant'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- Danger text at rest with the ordinary focus fill; the destructive variant would
     also tint the focus fill and the icon. -->
<DropdownMenu.Item bind:ref class={cn('text-destructive', className)} {...restProps} />
