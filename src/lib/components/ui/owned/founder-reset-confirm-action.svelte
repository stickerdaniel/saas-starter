<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { cn } from '$lib/utils.js';
	import type { ComponentProps } from 'svelte';

	type Props = Omit<ComponentProps<typeof AlertDialog.Action>, 'variant' | 'size'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- A solid destructive confirmation, stronger than the tinted destructive variant. -->
<AlertDialog.Action
	bind:ref
	class={cn('bg-destructive text-white hover:bg-destructive/90', className)}
	{...restProps}
/>
