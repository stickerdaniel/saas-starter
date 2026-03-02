<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
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
			return field.displayUsing(value, record, field.attribute);
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

	// currency formatting
	const currencyDisplay = $derived.by(() => {
		if (field.type !== 'currency') return '';
		const numVal = Number(value ?? 0);
		if (!Number.isFinite(numVal)) return '';
		try {
			return new Intl.NumberFormat(field.currencyLocale ?? 'en-US', {
				style: 'currency',
				currency: field.currencyCode ?? 'USD'
			}).format(numVal / 100);
		} catch {
			return String(numVal / 100);
		}
	});

	// booleanGroup count
	const booleanGroupCount = $derived.by(() => {
		if (field.type !== 'booleanGroup' || !field.options) return '';
		if (!value || typeof value !== 'object' || Array.isArray(value))
			return '0/' + (field.options?.length ?? 0);
		const vals = value as Record<string, boolean>;
		const trueCount = field.options.filter((opt) => vals[opt.value]).length;
		return `${trueCount}/${field.options.length}`;
	});

	// multiselect display
	const multiselectDisplay = $derived.by(() => {
		if (field.type !== 'multiselect' || !field.options) return '-';
		if (!Array.isArray(value) || value.length === 0) return '-';
		const selected = new Set(value.map(String));
		const labels = field.options
			.filter((opt) => selected.has(opt.value))
			.map((opt) => opt.labelKey);
		return labels;
	});

	// avatar initials
	const avatarInitials = $derived.by(() => {
		if (field.type !== 'avatar') return '';
		const nameField = field.avatarNameField ?? 'name';
		const name = String(record[nameField] ?? '');
		return name
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	});
</script>

{#if mode === 'loading'}
	{#if field.type === 'image'}
		<div class="flex items-center gap-2">
			<Skeleton class="size-8 rounded-full" />
			<Skeleton class="h-4 w-24" />
		</div>
	{:else if field.type === 'avatar'}
		<Skeleton class="size-8 rounded-full" />
	{:else if field.type === 'select' && field.inlineEditable}
		<Skeleton class="h-8 w-24 min-w-24 rounded-md" />
	{:else if field.type === 'boolean' && field.inlineEditable}
		<div class="flex items-center justify-center">
			<Skeleton class="h-4 w-4 rounded-sm" />
		</div>
	{:else if field.type === 'select' || field.type === 'badge' || field.type === 'boolean' || field.type === 'status'}
		<Skeleton class="h-5 w-14 rounded-md" />
	{:else if field.type === 'email'}
		<Skeleton class="h-4 w-40" />
	{:else if field.type === 'number' || field.type === 'currency'}
		<Skeleton class="h-4 w-16" />
	{:else if field.type === 'date' || field.type === 'datetime'}
		<Skeleton class="h-4 w-20" />
	{:else if field.type === 'hasMany'}
		<Skeleton class="h-5 w-12 rounded-md" />
	{:else if field.type === 'color'}
		<Skeleton class="size-6 rounded-full" />
	{:else if field.type === 'booleanGroup'}
		<Skeleton class="h-5 w-10 rounded-md" />
	{:else if field.type === 'multiselect' || field.type === 'keyValue'}
		<Skeleton class="h-5 w-14 rounded-md" />
	{:else if field.type === 'password'}
		<Skeleton class="h-4 w-12" />
	{:else}
		<Skeleton class="h-4 w-24" />
	{/if}
{:else if field.type === 'password'}
	<span data-testid={testId}><T keyName="admin.resources.values.masked" /></span>
{:else if field.type === 'color'}
	<div class="flex items-center gap-2" data-testid={testId}>
		<div
			class="size-5 rounded-full border"
			style="background-color: {String(value ?? '#000000')}"
		></div>
		<span class="text-xs text-muted-foreground">{String(value ?? '')}</span>
	</div>
{:else if field.type === 'currency'}
	<span data-testid={testId}>{currencyDisplay || '-'}</span>
{:else if field.type === 'keyValue'}
	{@const entries =
		value && typeof value === 'object' && !Array.isArray(value)
			? Object.keys(value as Record<string, unknown>).length
			: 0}
	<Badge variant="secondary" data-testid={testId}>
		<T keyName="admin.resources.values.pairs_count" params={{ count: entries }} />
	</Badge>
{:else if field.type === 'booleanGroup'}
	<Badge variant="secondary" data-testid={testId}>{booleanGroupCount}</Badge>
{:else if field.type === 'multiselect'}
	{#if Array.isArray(multiselectDisplay)}
		<span data-testid={testId} class="truncate">
			{#each multiselectDisplay as labelKey, i (labelKey)}
				{#if i > 0},
				{/if}<T keyName={labelKey} />
			{/each}
		</span>
	{:else}
		<span data-testid={testId}>{multiselectDisplay}</span>
	{/if}
{:else if field.type === 'status'}
	{#if field.statusMapping}
		{@const mapping = field.statusMapping[String(value ?? '')]}
		{#if mapping}
			<Badge variant={mapping.variant} data-testid={testId}><T keyName={mapping.labelKey} /></Badge>
		{:else}
			<Badge variant="secondary" data-testid={testId}>{String(value ?? '-')}</Badge>
		{/if}
	{:else}
		<Badge variant="secondary" data-testid={testId}>{String(value ?? '-')}</Badge>
	{/if}
{:else if field.type === 'avatar'}
	<Avatar.Root class="size-8">
		{#if typeof value === 'string' && value.length > 0}
			<Avatar.Image src={value} alt="" />
		{/if}
		<Avatar.Fallback class="text-xs">{avatarInitials || '?'}</Avatar.Fallback>
	</Avatar.Root>
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
