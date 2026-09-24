<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let { class: className, ...rest }: SVGAttributes<SVGSVGElement> = $props();
</script>

<svg
	height="1em"
	class={cn('flex-none leading-none', className)}
	viewBox="0 0 256 256"
	xmlns="http://www.w3.org/2000/svg"
	width="1em"
	{...rest}
	><path fill="none" d="M0 0h256v256H0z" /><path
		fill="none"
		stroke="currentColor"
		stroke-width="25"
		stroke-linecap="round"
		d="M208 128l-80 80M192 40L40 192"
	/>
</svg>
