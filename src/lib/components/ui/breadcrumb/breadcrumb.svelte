<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import type { WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

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
	class={className}
	aria-label={$t('aria.breadcrumb')}
	{...restProps}
>
	{@render children?.()}
</nav>
