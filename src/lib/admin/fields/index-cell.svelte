<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import type { FieldDefinition } from '$lib/admin/types';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		record: Record<string, unknown>;
		mode?: 'resolved' | 'loading';
		testId?: string;
	};

	let { field, value, record, mode = 'resolved', testId }: Props = $props();

	const displayValue = $derived.by(() => {
		if (field.displayUsing) {
			return field.displayUsing(value, record);
		}
		if (field.type === 'boolean') {
			return value ? 'true' : 'false';
		}
		if (field.type === 'morphTo') {
			return (record.targetTitle as string | undefined) ?? '-';
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
		if (field.type === 'hasMany') {
			return String(value ?? 0);
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

{#if mode === 'loading'}
	{#if field.type === 'image'}
		<div class="flex items-center gap-2">
			<Skeleton class="size-8 rounded-full" />
			<Skeleton class="h-4 w-24" />
		</div>
	{:else if field.type === 'select' && field.inlineEditable}
		<Skeleton class="h-8 min-w-24 w-24 rounded-md" />
	{:else if field.type === 'boolean' && field.inlineEditable}
		<div class="flex items-center justify-center">
			<Skeleton class="h-4 w-4 rounded-sm" />
		</div>
	{:else if field.type === 'select' || field.type === 'badge' || field.type === 'boolean'}
		<Skeleton class="h-5 w-14 rounded-md" />
	{:else if field.type === 'email'}
		<Skeleton class="h-4 w-40" />
	{:else if field.type === 'number'}
		<Skeleton class="h-4 w-16" />
	{:else if field.type === 'date' || field.type === 'datetime'}
		<Skeleton class="h-4 w-20" />
	{:else if field.type === 'hasMany'}
		<Skeleton class="h-5 w-12 rounded-md" />
	{:else}
		<Skeleton class="h-4 w-24" />
	{/if}
{:else if field.type === 'boolean'}
	<Badge variant={value ? 'default' : 'secondary'} data-testid={testId}>
		{#if value}
			<T keyName="admin.resources.values.yes" />
		{:else}
			<T keyName="admin.resources.values.no" />
		{/if}
	</Badge>
{:else if selectLabelKey}
	<Badge variant="secondary" data-testid={testId}><T keyName={selectLabelKey} /></Badge>
{:else if field.type === 'badge'}
	<Badge data-testid={testId}>{displayValue}</Badge>
{:else if field.type === 'image' && typeof value === 'string' && value.length > 0}
	<img src={value} alt="" class="size-8 rounded object-cover" data-testid={testId} />
{:else if field.type === 'file' && typeof value === 'string' && value.length > 0}
	<button
		type="button"
		class="text-primary underline"
		data-testid={testId}
		onclick={() => window.open(value, '_blank', 'noopener,noreferrer')}
	>
		{value}
	</button>
{:else}
	<span data-testid={testId}>{displayValue}</span>
{/if}
