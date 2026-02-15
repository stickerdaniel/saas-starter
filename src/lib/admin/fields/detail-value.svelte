<script lang="ts">
	import { T } from '@tolgee/svelte';
	import type { FieldDefinition } from '$lib/admin/types';
	import { Badge } from '$lib/components/ui/badge/index.js';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		record: Record<string, unknown>;
	};

	let { field, value, record }: Props = $props();

	const displayValue = $derived.by(() => {
		if (field.displayUsing) {
			return field.displayUsing(value, record);
		}
		if (field.type === 'morphTo') {
			const targetKind = (record.targetKind as string | undefined) ?? '';
			const targetTitle = (record.targetTitle as string | undefined) ?? '-';
			return `${targetKind}: ${targetTitle}`;
		}
		if (field.type === 'belongsTo') {
			return (record.projectName as string | undefined) ?? String(value ?? '-');
		}
		if (field.type === 'manyToMany') {
			const tags = (record.tags as Array<{ name: string }> | undefined) ?? [];
			if (tags.length === 0) return '-';
			return tags.map((tag) => tag.name).join(', ');
		}
		return String(value ?? '-');
	});

	const selectLabelKey = $derived.by(() => {
		if (field.type !== 'select' || !field.options) return undefined;
		const option = field.options.find((entry) => entry.value === String(value));
		return option?.labelKey;
	});
</script>

<div class="space-y-2">
	<p class="text-sm font-medium text-muted-foreground"><T keyName={field.labelKey} /></p>
	{#if field.type === 'boolean'}
		<Badge variant={value ? 'default' : 'secondary'}>
			{#if value}
				<T keyName="admin.resources.values.yes" />
			{:else}
				<T keyName="admin.resources.values.no" />
			{/if}
		</Badge>
	{:else if selectLabelKey}
		<Badge variant="secondary"><T keyName={selectLabelKey} /></Badge>
	{:else}
		<p class="text-sm leading-6">{displayValue}</p>
	{/if}
</div>
