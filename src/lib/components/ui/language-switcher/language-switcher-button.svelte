<script lang="ts">
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import { Button, type ButtonProps } from '#lib/components/ui/button/index.js';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	let { ref = $bindable(null), ...restProps }: Omit<ButtonProps, 'size' | 'children'> = $props();
</script>

<Button bind:ref size="icon" {...restProps}>
	<GlobeIcon class="size-4" />
	<span class="sr-only">{$t('aria.change_language')}</span>
</Button>
