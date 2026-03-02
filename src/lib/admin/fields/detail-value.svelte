<script lang="ts">
	import { T } from '@tolgee/svelte';
	import type { FieldDefinition } from '$lib/admin/types';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		record: Record<string, unknown>;
		mode?: 'resolved' | 'loading';
	};

	let { field, value, record, mode = 'resolved' }: Props = $props();

	const displayValue = $derived.by(() => {
		if (field.displayUsing) {
			return field.displayUsing(value, record, field.attribute);
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
		if (field.type === 'manyToMany' || field.type === 'tag') {
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
		if (!Number.isFinite(numVal)) return '-';
		try {
			return new Intl.NumberFormat(field.currencyLocale ?? 'en-US', {
				style: 'currency',
				currency: field.currencyCode ?? 'USD'
			}).format(numVal / 100);
		} catch {
			return String(numVal / 100);
		}
	});

	// keyValue pairs
	const keyValueEntries = $derived.by(() => {
		if (field.type !== 'keyValue') return [];
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			return Object.entries(value as Record<string, string>);
		}
		return [];
	});

	// booleanGroup true labels
	const booleanGroupTrueLabels = $derived.by(() => {
		if (field.type !== 'booleanGroup' || !field.options) return [];
		if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
		const vals = value as Record<string, boolean>;
		return field.options.filter((opt) => vals[opt.value]).map((opt) => opt.labelKey);
	});

	// multiselect labels
	const multiselectLabels = $derived.by(() => {
		if (field.type !== 'multiselect' || !field.options) return [];
		if (!Array.isArray(value)) return [];
		const selected = new Set(value.map(String));
		return field.options.filter((opt) => selected.has(opt.value)).map((opt) => opt.labelKey);
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

<div class="space-y-2">
	<p class="text-sm font-medium text-muted-foreground"><T keyName={field.labelKey} /></p>
	{#if mode === 'loading'}
		{#if field.type === 'boolean' || field.type === 'select' || field.type === 'badge' || field.type === 'status'}
			<Skeleton class="h-5 w-14 rounded-md" />
		{:else if field.type === 'image'}
			<Skeleton class="h-32 w-full rounded-md" />
		{:else if field.type === 'avatar'}
			<Skeleton class="size-12 rounded-full" />
		{:else if field.type === 'date' || field.type === 'datetime'}
			<Skeleton class="h-4 w-24" />
		{:else if field.type === 'number' || field.type === 'currency'}
			<Skeleton class="h-4 w-16" />
		{:else if field.type === 'email' || field.type === 'url'}
			<Skeleton class="h-4 w-40" />
		{:else if field.type === 'color'}
			<Skeleton class="h-6 w-20 rounded" />
		{:else if field.type === 'keyValue'}
			<Skeleton class="h-12 w-40" />
		{:else if field.type === 'booleanGroup' || field.type === 'multiselect'}
			<Skeleton class="h-5 w-24 rounded-md" />
		{:else if field.type === 'password'}
			<Skeleton class="h-4 w-20" />
		{:else}
			<Skeleton class="h-4 w-32" />
		{/if}
	{:else if field.type === 'heading'}
		<!-- headings have no data value -->
	{:else if field.type === 'line'}
		<!-- lines have no data value -->
	{:else if field.type === 'password'}
		<p class="text-sm leading-6"><T keyName="admin.resources.values.masked" /></p>
	{:else if field.type === 'color'}
		<div class="flex items-center gap-2">
			<div
				class="size-6 rounded border"
				style="background-color: {String(value ?? '#000000')}"
			></div>
			<span class="text-sm">{String(value ?? '-')}</span>
		</div>
	{:else if field.type === 'currency'}
		<p class="text-sm leading-6">{currencyDisplay || '-'}</p>
	{:else if field.type === 'keyValue'}
		{#if keyValueEntries.length === 0}
			<p class="text-sm leading-6">-</p>
		{:else}
			<dl class="space-y-1">
				{#each keyValueEntries as [key, val] (key)}
					<div class="flex gap-2 text-sm">
						<dt class="font-medium">{key}:</dt>
						<dd>{val}</dd>
					</div>
				{/each}
			</dl>
		{/if}
	{:else if field.type === 'booleanGroup'}
		{#if booleanGroupTrueLabels.length === 0}
			<p class="text-sm leading-6">-</p>
		{:else}
			<div class="flex flex-wrap gap-1">
				{#each booleanGroupTrueLabels as labelKey (labelKey)}
					<Badge variant="secondary"><T keyName={labelKey} /></Badge>
				{/each}
			</div>
		{/if}
	{:else if field.type === 'multiselect'}
		{#if multiselectLabels.length === 0}
			<p class="text-sm leading-6">-</p>
		{:else}
			<div class="flex flex-wrap gap-1">
				{#each multiselectLabels as labelKey (labelKey)}
					<Badge variant="secondary"><T keyName={labelKey} /></Badge>
				{/each}
			</div>
		{/if}
	{:else if field.type === 'status'}
		{#if field.statusMapping}
			{@const mapping = field.statusMapping[String(value ?? '')]}
			{#if mapping}
				<Badge variant={mapping.variant}><T keyName={mapping.labelKey} /></Badge>
			{:else}
				<Badge variant="secondary">{String(value ?? '-')}</Badge>
			{/if}
		{:else}
			<Badge variant="secondary">{String(value ?? '-')}</Badge>
		{/if}
	{:else if field.type === 'avatar'}
		<Avatar.Root class="size-12">
			{#if typeof value === 'string' && value.length > 0}
				<Avatar.Image src={value} alt="" />
			{/if}
			<Avatar.Fallback>{avatarInitials || '?'}</Avatar.Fallback>
		</Avatar.Root>
	{:else if field.type === 'boolean'}
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
