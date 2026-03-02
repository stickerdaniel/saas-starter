<script lang="ts">
	import { Debounced } from 'runed';
	import { T, getTranslate } from '@tolgee/svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';

	type Props = {
		type?: string;
		value: string;
		disabled?: boolean;
		maxlength?: number | undefined;
		placeholder?: string | undefined;
		suggestions: string[] | ((query: string) => Promise<string[]>);
		testId?: string;
		onInput: (value: string) => void;
	};

	let {
		type = 'text',
		value,
		disabled = false,
		maxlength,
		placeholder,
		suggestions,
		testId,
		onInput
	}: Props = $props();

	const { t } = getTranslate();

	let open = $state(false);
	let inputRef = $state<HTMLInputElement | null>(null);
	let dynamicResults: string[] = $state([]);
	let loading = $state(false);

	const isDynamic = $derived(typeof suggestions === 'function');

	const debouncedQuery = new Debounced(() => value, 200);

	const filteredSuggestions: string[] = $derived.by(() => {
		if (isDynamic) {
			return dynamicResults;
		}
		const staticList = suggestions as string[];
		const query = (value ?? '').toLowerCase().trim();
		if (!query) return staticList;
		return staticList.filter((s) => s.toLowerCase().includes(query));
	});

	const shouldShowPopover = $derived(open && !disabled && filteredSuggestions.length > 0);

	// Dynamic suggestions fetcher
	$effect(() => {
		if (!isDynamic) return;
		const query = debouncedQuery.current;
		const fn = suggestions as (query: string) => Promise<string[]>;
		loading = true;
		fn(query ?? '')
			.then((results) => {
				dynamicResults = results;
			})
			.catch(() => {
				dynamicResults = [];
			})
			.finally(() => {
				loading = false;
			});
	});

	function handleInput(event: Event) {
		const inputValue = (event.currentTarget as HTMLInputElement).value;
		onInput(inputValue);
		if (!open) open = true;
	}

	function handleSelect(suggestion: string) {
		onInput(suggestion);
		open = false;
		inputRef?.focus();
	}

	function handleFocus() {
		if (filteredSuggestions.length > 0) {
			open = true;
		}
	}

	function handleBlur() {
		// Small delay to allow click on suggestion items
		setTimeout(() => {
			open = false;
		}, 200);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			open = false;
		} else if (event.key === 'ArrowDown' && !open && filteredSuggestions.length > 0) {
			open = true;
		}
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<div {...props} class="w-full">
				<Input
					bind:ref={inputRef}
					{type}
					{value}
					{disabled}
					{maxlength}
					{placeholder}
					oninput={handleInput}
					onfocus={handleFocus}
					onblur={handleBlur}
					onkeydown={handleKeydown}
					role="combobox"
					aria-expanded={shouldShowPopover}
					aria-autocomplete="list"
					aria-label={placeholder ?? $t('admin.resources.form.suggestions_input')}
					autocomplete="off"
					data-testid={testId}
				/>
			</div>
		{/snippet}
	</Popover.Trigger>
	{#if shouldShowPopover}
		<Popover.Content
			class="w-[var(--bits-popover-trigger-width)] p-0"
			sideOffset={4}
			onOpenAutoFocus={(e) => e.preventDefault()}
			onCloseAutoFocus={(e) => e.preventDefault()}
		>
			<Command.Root shouldFilter={false}>
				<Command.List class="max-h-[200px]">
					{#if loading}
						<Command.Loading>
							<T keyName="admin.resources.form.suggestions_loading" />
						</Command.Loading>
					{:else if filteredSuggestions.length === 0}
						<Command.Empty>
							<T keyName="admin.resources.form.no_suggestions" />
						</Command.Empty>
					{:else}
						{#each filteredSuggestions as suggestion (suggestion)}
							<Command.Item
								value={suggestion}
								onSelect={() => handleSelect(suggestion)}
								data-testid={testId ? `${testId}-suggestion-${suggestion}` : undefined}
							>
								{suggestion}
							</Command.Item>
						{/each}
					{/if}
				</Command.List>
			</Command.Root>
		</Popover.Content>
	{/if}
</Popover.Root>
