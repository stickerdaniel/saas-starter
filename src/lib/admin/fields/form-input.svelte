<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { T, getTranslate } from '@tolgee/svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import InlineCreateModal from '$lib/admin/components/inline-create-modal.svelte';
	import { getResourceByName, getResourceRuntime } from '$lib/admin/registry';
	import type { FieldDefinition } from '$lib/admin/types';
	import type { BetterAuthUser } from '$lib/convex/admin/types';

	type Option = { value: string; label: string };

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		error?: string;
		disabled?: boolean;
		testId?: string;
		relationOptions?: Option[];
		allValues?: Record<string, unknown>;
		viewer?: BetterAuthUser;
		onChange: (value: unknown) => void;
		onRelationCreated?: (fieldAttribute: string, newOption: Option) => void;
	};

	let {
		field,
		value,
		error,
		disabled = false,
		testId,
		relationOptions = [],
		allValues = {},
		viewer,
		onChange,
		onRelationCreated
	}: Props = $props();
	const { t } = getTranslate();

	// Inline creation state
	let inlineCreateOpen = $state(false);

	const canInlineCreate = $derived(
		field.inlineCreatable &&
			(field.type === 'belongsTo' || field.type === 'morphTo') &&
			field.relation?.resourceName
	);

	const targetResource = $derived(
		canInlineCreate && field.relation ? getResourceByName(field.relation.resourceName) : undefined
	);

	const targetRuntime = $derived(
		canInlineCreate && field.relation ? getResourceRuntime(field.relation.resourceName) : undefined
	);

	const inlineFieldSubset = $derived.by(() => {
		if (!field.inlineCreatable || typeof field.inlineCreatable === 'boolean') return undefined;
		return field.inlineCreatable.fields;
	});

	function handleInlineCreated(newId: string) {
		onChange(newId);
		if (onRelationCreated && targetResource) {
			onRelationCreated(field.attribute, { value: newId, label: newId });
		}
	}

	const selectOptions = $derived.by(() => {
		if (field.type === 'select' && field.options) {
			return field.options.map((option) => ({
				value: option.value,
				label: option.labelKey,
				translatable: true
			}));
		}
		if (
			(field.type === 'belongsTo' || field.type === 'manyToMany' || field.type === 'morphTo') &&
			relationOptions.length > 0
		) {
			return relationOptions.map((option) => ({
				...option,
				translatable: false
			}));
		}
		return [];
	});

	const selectedManyValues = $derived.by(() => {
		if (!Array.isArray(value)) return [];
		return value.map((entry) => String(entry));
	});

	function handleManyToManyToggle(optionValue: string, checked: boolean) {
		const set = new SvelteSet(selectedManyValues);
		if (checked) {
			set.add(optionValue);
		} else {
			set.delete(optionValue);
		}
		onChange(Array.from(set));
	}

	// slug auto-generation
	function toSlug(input: string) {
		return input
			.toLowerCase()
			.trim()
			.replace(/[^\w\s-]/g, '')
			.replace(/[\s_]+/g, '-')
			.replace(/-+/g, '-');
	}

	$effect(() => {
		if (field.type === 'slug' && field.slugFrom) {
			const source = allValues[field.slugFrom];
			if (typeof source === 'string' && source.length > 0) {
				const generated = toSlug(source);
				if (!value || value === toSlug(String(value))) {
					onChange(generated);
				}
			}
		}
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

	// booleanGroup helpers
	const booleanGroupValues = $derived.by(() => {
		if (field.type !== 'booleanGroup') return {} as Record<string, boolean>;
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			return value as Record<string, boolean>;
		}
		return {} as Record<string, boolean>;
	});

	function handleBooleanGroupToggle(optionValue: string, checked: boolean) {
		const next = { ...booleanGroupValues, [optionValue]: Boolean(checked) };
		onChange(next);
	}

	// multiselect helpers
	const multiselectValues = $derived.by(() => {
		if (!Array.isArray(value)) return [] as string[];
		return value.map((entry) => String(entry));
	});

	function handleMultiselectToggle(optionValue: string, checked: boolean) {
		const set = new SvelteSet(multiselectValues);
		if (checked) {
			set.add(optionValue);
		} else {
			set.delete(optionValue);
		}
		onChange(Array.from(set));
	}
</script>

{#if field.type === 'heading'}
	<!-- heading is handled by FormHeading, not rendered here -->
{:else if field.type === 'line'}
	<!-- line is handled by FormLine, not rendered here -->
{:else if field.type === 'hidden'}
	<input type="hidden" value={String(value ?? '')} data-testid={testId} />
{:else}
	<Field.Field>
		<Field.Label><T keyName={field.labelKey} /></Field.Label>

		{#if field.type === 'textarea'}
			<Textarea
				value={String(value ?? '')}
				{disabled}
				placeholder={field.placeholderKey ? $t(field.placeholderKey) : undefined}
				oninput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)}
				data-testid={testId}
			/>
		{:else if field.type === 'boolean'}
			<div class="flex items-center gap-3 py-2">
				<Checkbox
					checked={Boolean(value)}
					{disabled}
					onCheckedChange={(checked) => onChange(Boolean(checked))}
					data-testid={testId}
				/>
				<span class="text-sm text-muted-foreground"
					><T keyName="admin.resources.values.enabled" /></span
				>
			</div>
		{:else if field.type === 'select' || field.type === 'belongsTo' || field.type === 'morphTo'}
			<div class="flex items-center gap-2">
				<div class="flex-1">
					<Select.Root
						type="single"
						value={String(value ?? '')}
						{disabled}
						onValueChange={(next) => {
							onChange(next);
						}}
					>
						<Select.Trigger data-testid={testId}>
							{#if field.placeholderKey}
								<T keyName={field.placeholderKey} />
							{:else}
								<T keyName="admin.resources.filters.select_placeholder" />
							{/if}
						</Select.Trigger>
						<Select.Content>
							{#each selectOptions as option (option.value)}
								<Select.Item value={option.value}>
									{#if option.translatable}
										<T keyName={option.label} />
									{:else}
										{option.label}
									{/if}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				{#if canInlineCreate && targetResource && targetRuntime}
					<Button
						variant="outline"
						size="icon"
						{disabled}
						onclick={() => (inlineCreateOpen = true)}
						data-testid={testId ? `${testId}-inline-create` : undefined}
					>
						<PlusIcon class="h-4 w-4" />
						<span class="sr-only"><T keyName="admin.resources.form.inline_create_button" /></span>
					</Button>
				{/if}
			</div>
			{#if canInlineCreate && targetResource && targetRuntime}
				<InlineCreateModal
					open={inlineCreateOpen}
					{targetResource}
					{targetRuntime}
					fieldSubset={inlineFieldSubset}
					{viewer}
					onOpenChange={(next) => (inlineCreateOpen = next)}
					onCreated={handleInlineCreated}
				/>
			{/if}
		{:else if field.type === 'manyToMany'}
			<div class="space-y-2 rounded-md border p-3">
				{#if selectOptions.length === 0}
					<p class="text-sm text-muted-foreground">
						<T keyName="admin.resources.form.no_relation_options" />
					</p>
				{:else}
					{#each selectOptions as option (option.value)}
						<label class="flex items-center gap-2">
							<Checkbox
								checked={selectedManyValues.includes(option.value)}
								{disabled}
								onCheckedChange={(checked) =>
									handleManyToManyToggle(option.value, Boolean(checked))}
								data-testid={testId ? `${testId}-${option.value}` : undefined}
							/>
							<span class="text-sm">{option.label}</span>
						</label>
					{/each}
				{/if}
			</div>
		{:else if field.type === 'password'}
			<Input
				type="password"
				value={String(value ?? '')}
				{disabled}
				placeholder={field.placeholderKey ? $t(field.placeholderKey) : undefined}
				oninput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
				data-testid={testId}
			/>
		{:else if field.type === 'color'}
			<div class="flex items-center gap-3">
				<input
					type="color"
					value={String(value ?? '#000000')}
					{disabled}
					oninput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
					data-testid={testId}
					class="h-10 w-14 cursor-pointer rounded border"
				/>
				<Input
					type="text"
					value={String(value ?? '')}
					{disabled}
					placeholder="#000000"
					oninput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
					class="max-w-32"
				/>
			</div>
		{:else if field.type === 'slug'}
			<div class="space-y-1">
				<Input
					type="text"
					value={String(value ?? '')}
					{disabled}
					placeholder={field.placeholderKey ? $t(field.placeholderKey) : undefined}
					oninput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
					data-testid={testId}
				/>
				{#if field.slugFrom && value}
					<p class="text-xs text-muted-foreground">
						<T keyName="admin.resources.form.slug_preview" />: {value}
					</p>
				{/if}
			</div>
		{:else if field.type === 'currency'}
			<div class="space-y-1">
				<Input
					type="number"
					value={String(value ?? '')}
					{disabled}
					placeholder={field.placeholderKey ? $t(field.placeholderKey) : '0'}
					oninput={(event) =>
						onChange(Number((event.currentTarget as HTMLInputElement).value || '0'))}
					data-testid={testId}
				/>
				{#if currencyDisplay}
					<p class="text-xs text-muted-foreground">{currencyDisplay}</p>
				{/if}
			</div>
		{:else if field.type === 'booleanGroup' && field.options}
			<div class="space-y-2 rounded-md border p-3">
				{#each field.options as option (option.value)}
					<label class="flex items-center gap-2">
						<Checkbox
							checked={Boolean(booleanGroupValues[option.value])}
							{disabled}
							onCheckedChange={(checked) =>
								handleBooleanGroupToggle(option.value, Boolean(checked))}
							data-testid={testId ? `${testId}-${option.value}` : undefined}
						/>
						<span class="text-sm"><T keyName={option.labelKey} /></span>
					</label>
				{/each}
			</div>
		{:else if field.type === 'multiselect' && field.options}
			<div class="space-y-2 rounded-md border p-3">
				{#each field.options as option (option.value)}
					<label class="flex items-center gap-2">
						<Checkbox
							checked={multiselectValues.includes(option.value)}
							{disabled}
							onCheckedChange={(checked) => handleMultiselectToggle(option.value, Boolean(checked))}
							data-testid={testId ? `${testId}-${option.value}` : undefined}
						/>
						<span class="text-sm"><T keyName={option.labelKey} /></span>
					</label>
				{/each}
			</div>
		{:else if field.type === 'status'}
			<!-- status fields are not editable on forms -->
			{#if field.statusMapping}
				{@const mapping = field.statusMapping[String(value ?? '')]}
				{#if mapping}
					<p class="text-sm"><T keyName={mapping.labelKey} /></p>
				{:else}
					<p class="text-sm text-muted-foreground">{String(value ?? '-')}</p>
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground">{String(value ?? '-')}</p>
			{/if}
		{:else}
			<Input
				type={field.type === 'number'
					? 'number'
					: field.type === 'email'
						? 'email'
						: field.type === 'url'
							? 'url'
							: field.type === 'date'
								? 'date'
								: field.type === 'datetime'
									? 'datetime-local'
									: 'text'}
				value={String(value ?? '')}
				{disabled}
				placeholder={field.placeholderKey ? $t(field.placeholderKey) : undefined}
				oninput={(event) => {
					const inputValue = (event.currentTarget as HTMLInputElement).value;
					onChange(field.type === 'number' ? Number(inputValue || '0') : inputValue);
				}}
				data-testid={testId}
			/>
		{/if}

		{#if field.helpTextKey}
			<Field.Description><T keyName={field.helpTextKey} /></Field.Description>
		{/if}

		{#if error}
			<Field.Error>{error}</Field.Error>
		{/if}
	</Field.Field>
{/if}
