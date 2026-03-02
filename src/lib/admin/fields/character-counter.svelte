<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';

	type Props = {
		count: number;
		limit: number;
	};

	let { count, limit }: Props = $props();

	const { t } = getTranslate();

	const ratio = $derived(limit > 0 ? count / limit : 0);
	const colorClass = $derived(
		ratio > 0.95 ? 'text-destructive' : ratio > 0.8 ? 'text-amber-500' : 'text-muted-foreground'
	);
</script>

<p class="text-right text-xs {colorClass}" aria-live="polite">
	{$t('admin.resources.form.characters_count', { count, limit })}
</p>
