<script lang="ts">
	import type { IconProps } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	// Accept IconProps for compatibility with LucideIcon type, but only use class
	let { class: className }: IconProps = $props();
</script>

<span
	class={cn(
		'inline-block bg-[var(--logo-color,currentColor)] [mask-image:url(/logo.svg)] [mask-size:contain] [mask-position:center] [mask-repeat:no-repeat]',
		className
	)}
></span>
