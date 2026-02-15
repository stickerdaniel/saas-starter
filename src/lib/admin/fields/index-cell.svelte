<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { FieldDefinition } from '$lib/admin/types';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		record: Record<string, unknown>;
		testId?: string;
	};

	let { field, value, record, testId }: Props = $props();

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
			return (record.projectName as string | undefined) ?? String(value ?? '-');
		}
		if (field.type === 'hasMany') {
			return String(value ?? 0);
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

{#if field.type === 'boolean'}
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
{:else}
	<span data-testid={testId}>{displayValue}</span>
{/if}
