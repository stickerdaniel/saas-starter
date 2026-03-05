<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import type { ComponentProps } from 'svelte';

	const { t } = getTranslate();

	type Props = ComponentProps<typeof Checkbox> & {
		'aria-label-key'?: string;
	};

	let {
		checked = false,
		onCheckedChange = (v) => (checked = v),
		'aria-label-key': ariaLabelKey,
		'aria-label': ariaLabel,
		...restProps
	}: Props = $props();

	const translatedAriaLabel = $derived(ariaLabelKey ? $t(ariaLabelKey) : ariaLabel);
</script>

<div class="flex items-center justify-center">
	<Checkbox
		bind:checked={
			() => checked,
			(v) => {
				haptic.trigger('selection');
				onCheckedChange(v);
			}
		}
		aria-label={translatedAriaLabel}
		{...restProps}
	/>
</div>
