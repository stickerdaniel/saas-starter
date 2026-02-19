<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import type { FieldDefinition } from '$lib/admin/types';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		error?: string;
		disabled?: boolean;
		testId?: string;
		onChange: (value: unknown) => void;
	};

	let { field, value, error, disabled = false, testId, onChange }: Props = $props();
	const { t } = getTranslate();

	type Pair = { key: string; value: string };

	let userEdited = $state(false);
	let pairs: Pair[] = $state(toPairs(value));

	// Sync pairs from external value changes (e.g. hydration from record)
	$effect(() => {
		if (!userEdited) {
			pairs = toPairs(value);
		}
	});

	function toPairs(input: unknown): Pair[] {
		if (input && typeof input === 'object' && !Array.isArray(input)) {
			const entries = Object.entries(input as Record<string, string>);
			return entries.length > 0
				? entries.map(([k, v]) => ({ key: k, value: String(v) }))
				: [{ key: '', value: '' }];
		}
		return [{ key: '', value: '' }];
	}

	function emitChange() {
		userEdited = true;
		const record: Record<string, string> = {};
		for (const pair of pairs) {
			if (pair.key.trim()) {
				record[pair.key.trim()] = pair.value;
			}
		}
		onChange(record);
	}

	function addPair() {
		pairs = [...pairs, { key: '', value: '' }];
	}

	function removePair(index: number) {
		pairs = pairs.filter((_, i) => i !== index);
		if (pairs.length === 0) {
			pairs = [{ key: '', value: '' }];
		}
		emitChange();
	}

	function updateKey(index: number, newKey: string) {
		pairs = pairs.map((p, i) => (i === index ? { ...p, key: newKey } : p));
		emitChange();
	}

	function updateValue(index: number, newValue: string) {
		pairs = pairs.map((p, i) => (i === index ? { ...p, value: newValue } : p));
		emitChange();
	}
</script>

<Field.Field>
	<Field.Label><T keyName={field.labelKey} /></Field.Label>

	<div class="space-y-2 rounded-md border p-3" data-testid={testId}>
		{#each pairs as pair, index (index)}
			<div class="flex items-center gap-2">
				<Input
					value={pair.key}
					{disabled}
					placeholder={$t('admin.resources.form.key_placeholder')}
					oninput={(event) => updateKey(index, (event.currentTarget as HTMLInputElement).value)}
					class="flex-1"
				/>
				<Input
					value={pair.value}
					{disabled}
					placeholder={$t('admin.resources.form.value_placeholder')}
					oninput={(event) => updateValue(index, (event.currentTarget as HTMLInputElement).value)}
					class="flex-1"
				/>
				<Button
					variant="ghost"
					size="icon"
					{disabled}
					onclick={() => removePair(index)}
					aria-label={$t('admin.resources.form.remove_pair')}
				>
					<XIcon class="size-4" />
				</Button>
			</div>
		{/each}

		<Button variant="outline" size="sm" {disabled} onclick={addPair}>
			<PlusIcon class="mr-1 size-4" />
			<T keyName="admin.resources.form.add_pair" />
		</Button>
	</div>

	{#if field.helpTextKey}
		<Field.Description><T keyName={field.helpTextKey} /></Field.Description>
	{/if}

	{#if error}
		<Field.Error>{error}</Field.Error>
	{/if}
</Field.Field>
