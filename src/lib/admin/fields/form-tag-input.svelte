<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { T, getTranslate } from '@tolgee/svelte';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
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
		onCreateTag?: (name: string) => Promise<string | null>;
	};

	let {
		field,
		value,
		error,
		disabled = false,
		testId,
		relationOptions = [],
		onChange,
		onCreateTag
	}: Props = $props();
	const { t } = getTranslate();

	let inputValue = $state('');
	let showSuggestions = $state(false);
	let creating = $state(false);
	let inputEl: HTMLInputElement | undefined = $state();

	const selectedIds: string[] = $derived.by(() => {
		if (!Array.isArray(value)) return [];
		return value.map((entry) => String(entry));
	});

	const selectedSet = $derived(new SvelteSet(selectedIds));

	const selectedOptions: Option[] = $derived.by(() => {
		return selectedIds
			.map((id) => relationOptions.find((opt) => opt.value === id))
			.filter((opt): opt is Option => opt !== undefined);
	});

	const filteredSuggestions: Option[] = $derived.by(() => {
		const query = inputValue.toLowerCase().trim();
		return relationOptions.filter(
			(opt) =>
				!selectedSet.has(opt.value) && (query === '' || opt.label.toLowerCase().includes(query))
		);
	});

	const canCreateInline = $derived(
		field.tagConfig?.allowCreate === true && onCreateTag !== undefined
	);

	const showCreateOption = $derived.by(() => {
		if (!canCreateInline) return false;
		const trimmed = inputValue.trim();
		if (trimmed.length === 0) return false;
		const lowerTrimmed = trimmed.toLowerCase();
		const existsInOptions = relationOptions.some((opt) => opt.label.toLowerCase() === lowerTrimmed);
		return !existsInOptions;
	});

	function removeTag(id: string) {
		onChange(selectedIds.filter((entry) => entry !== id));
	}

	function addTag(id: string) {
		if (selectedSet.has(id)) return;
		onChange([...selectedIds, id]);
		inputValue = '';
		showSuggestions = false;
	}

	async function handleCreateTag() {
		if (!onCreateTag || creating) return;
		const name = inputValue.trim();
		if (name.length === 0) return;
		creating = true;
		try {
			const newId = await onCreateTag(name);
			if (newId) {
				onChange([...selectedIds, newId]);
				inputValue = '';
				showSuggestions = false;
			}
		} finally {
			creating = false;
		}
	}

	function handleInputKeydown(event: KeyboardEvent) {
		if (event.key === 'Backspace' && inputValue === '' && selectedIds.length > 0) {
			removeTag(selectedIds[selectedIds.length - 1]);
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			if (showCreateOption) {
				handleCreateTag();
			} else if (filteredSuggestions.length > 0) {
				addTag(filteredSuggestions[0].value);
			}
		}
		if (event.key === 'Escape') {
			showSuggestions = false;
			inputEl?.blur();
		}
	}

	function handleInputFocus() {
		showSuggestions = true;
	}

	function handleInputBlur() {
		// Delay to allow click events on suggestions to fire
		setTimeout(() => {
			showSuggestions = false;
		}, 200);
	}
</script>

<Field.Field>
	<Field.Label><T keyName={field.labelKey} /></Field.Label>

	<div class="relative" data-testid={testId}>
		<div
			class="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
			class:opacity-50={disabled}
		>
			{#each selectedOptions as option (option.value)}
				<Badge variant="secondary" class="gap-1 pr-1">
					{option.label}
					{#if !disabled}
						<button
							type="button"
							class="rounded-full p-0.5 hover:bg-muted"
							onclick={() => removeTag(option.value)}
							aria-label={$t('admin.resources.form.tag_remove', { name: option.label })}
						>
							<XIcon class="size-3" />
						</button>
					{/if}
				</Badge>
			{/each}

			{#if !disabled}
				<Input
					bind:ref={inputEl}
					type="text"
					class="h-auto min-w-[120px] flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
					placeholder={selectedOptions.length === 0
						? field.placeholderKey
							? $t(field.placeholderKey)
							: $t('admin.resources.form.tag_placeholder')
						: $t('admin.resources.form.tag_add_more')}
					value={inputValue}
					oninput={(event) => {
						inputValue = (event.currentTarget as HTMLInputElement).value;
						showSuggestions = true;
					}}
					onkeydown={handleInputKeydown}
					onfocus={handleInputFocus}
					onblur={handleInputBlur}
					data-testid={testId ? `${testId}-input` : undefined}
				/>
			{/if}
		</div>

		{#if showSuggestions && !disabled && (filteredSuggestions.length > 0 || showCreateOption)}
			<div
				class="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
				data-testid={testId ? `${testId}-suggestions` : undefined}
			>
				{#each filteredSuggestions as suggestion (suggestion.value)}
					<button
						type="button"
						class="w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
						onmousedown={(e) => {
							e.preventDefault();
							addTag(suggestion.value);
						}}
					>
						{suggestion.label}
					</button>
				{/each}

				{#if showCreateOption}
					<button
						type="button"
						class="flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm text-primary hover:bg-accent hover:text-accent-foreground"
						{disabled}
						onmousedown={(e) => {
							e.preventDefault();
							handleCreateTag();
						}}
						data-testid={testId ? `${testId}-create` : undefined}
					>
						<PlusIcon class="size-3.5" />
						<T keyName="admin.resources.form.tag_create" params={{ name: inputValue.trim() }} />
					</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if field.helpTextKey}
		<Field.Description><T keyName={field.helpTextKey} /></Field.Description>
	{/if}

	{#if error}
		<Field.Error>{error}</Field.Error>
	{/if}
</Field.Field>
