<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { T, getTranslate } from '@tolgee/svelte';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { FieldDefinition } from '$lib/admin/types';

	type Option = { value: string; label: string };

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		error?: string;
		disabled?: boolean;
		testId?: string;
		relationOptions?: Option[];
		onChange: (value: unknown) => void;
	};

	let {
		field,
		value,
		error,
		disabled = false,
		testId,
		relationOptions = [],
		onChange
	}: Props = $props();
	const { t } = getTranslate();

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
</script>

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
							onCheckedChange={(checked) => handleManyToManyToggle(option.value, Boolean(checked))}
							data-testid={testId ? `${testId}-${option.value}` : undefined}
						/>
						<span class="text-sm">{option.label}</span>
					</label>
				{/each}
			{/if}
		</div>
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
