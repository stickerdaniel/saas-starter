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
			const fieldLabelKey = `${field.attribute}Label`;
			const fieldNameKey = field.attribute.endsWith('Id')
				? `${field.attribute.slice(0, -2)}Name`
				: `${field.attribute}Name`;
			return (
				(record[fieldLabelKey] as string | undefined) ??
				(record[fieldNameKey] as string | undefined) ??
				String(value ?? '-')
			);
		}
		if (field.type === 'manyToMany') {
			const items = Array.isArray(value) ? value : [];
			if (items.length === 0) return '-';
			const labelKey = field.relation?.labelField ?? 'name';
			return (
				items
					.map((item) =>
						typeof item === 'object' && item !== null
							? String((item as Record<string, unknown>)[labelKey] ?? '')
							: String(item)
					)
					.filter(Boolean)
					.join(', ') || '-'
			);
		}
		if ((field.type === 'date' || field.type === 'datetime') && typeof value === 'number') {
			const parsed = new Date(value);
			if (Number.isNaN(parsed.valueOf())) return '-';
			return field.type === 'date' ? parsed.toLocaleDateString() : parsed.toLocaleString();
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
	{:else if field.type === 'image' && typeof value === 'string' && value.length > 0}
		<img src={value} alt="" class="max-h-64 rounded-md border object-cover" />
	{:else if field.type === 'file' && typeof value === 'string' && value.length > 0}
		<button
			type="button"
			class="text-sm text-primary underline"
			onclick={() => window.open(value, '_blank', 'noopener,noreferrer')}
		>
			{value}
		</button>
	{:else}
		<p class="text-sm leading-6">{displayValue}</p>
	{/if}
</div>
