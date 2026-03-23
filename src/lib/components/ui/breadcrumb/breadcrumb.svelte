<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import type { WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	const { t } = getTranslate();

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<nav
	bind:this={ref}
	data-slot="breadcrumb"
	aria-label={$t('aria.breadcrumb')}
	class={cn('cn-breadcrumb', className)}
	{...restProps}
>
	{@render children?.()}
</nav>
