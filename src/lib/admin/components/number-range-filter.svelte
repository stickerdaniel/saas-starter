<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { T } from '@tolgee/svelte';

	type Props = {
		labelKey: string;
		value: string;
		testId?: string;
		onChange: (serialized: string) => void;
	};

	let { labelKey, value, testId, onChange }: Props = $props();
	let open = $state(false);

	const parsed: { min: number | null; max: number | null } = $derived.by(() => {
		if (!value || !value.includes('..')) return { min: null, max: null };
		const [minStr, maxStr] = value.split('..');
		const min = minStr !== '' ? Number(minStr) : null;
		const max = maxStr !== '' ? Number(maxStr) : null;
		return {
			min: min !== null && Number.isFinite(min) ? min : null,
			max: max !== null && Number.isFinite(max) ? max : null
		};
	});

	let minInput = $state('');
	let maxInput = $state('');

	// Sync local inputs when the external value prop changes (e.g., parent clear).
	// Local state is intentionally mutable for user editing; $derived would not work here.
	let syncedValue = $state('');
	$effect.pre(() => {
		if (value !== syncedValue) {
			syncedValue = value;
			minInput = parsed.min !== null ? String(parsed.min) : '';
			maxInput = parsed.max !== null ? String(parsed.max) : '';
		}
	});

	function serialize() {
		const min = minInput.trim();
		const max = maxInput.trim();
		if (!min && !max) {
			onChange('');
			return;
		}
		onChange(`${min}..${max}`);
	}

	function handleApply() {
		serialize();
		open = false;
	}

	function handleClear() {
		minInput = '';
		maxInput = '';
		onChange('');
		open = false;
	}

	const displayText = $derived.by(() => {
		if (parsed.min !== null && parsed.max !== null) {
			return `${parsed.min} - ${parsed.max}`;
		}
		if (parsed.min !== null) {
			return `>= ${parsed.min}`;
		}
		if (parsed.max !== null) {
			return `<= ${parsed.max}`;
		}
		return '';
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger data-testid={testId}>
		{#snippet child({ props })}
			<Button {...props} variant="outline" class="min-w-44 justify-between font-normal">
				{#if displayText}
					{displayText}
				{:else}
					<T keyName={labelKey} />
				{/if}
				<ChevronDownIcon class="ml-2 size-4" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-64" align="start">
		<div class="grid gap-3">
			<div class="grid gap-1.5">
				<Label for="number-range-min"
					><T keyName="admin.resources.filters.number_range_min" /></Label
				>
				<Input
					id="number-range-min"
					type="number"
					bind:value={minInput}
					data-testid={testId ? `${testId}-min` : undefined}
				/>
			</div>
			<div class="grid gap-1.5">
				<Label for="number-range-max"
					><T keyName="admin.resources.filters.number_range_max" /></Label
				>
				<Input
					id="number-range-max"
					type="number"
					bind:value={maxInput}
					data-testid={testId ? `${testId}-max` : undefined}
				/>
			</div>
			<div class="flex items-center justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={handleClear}>
					<T keyName="admin.resources.filters.clear" />
				</Button>
				<Button size="sm" onclick={handleApply}>
					<T keyName="admin.resources.filters.number_range_apply" />
				</Button>
			</div>
		</div>
	</Popover.Content>
</Popover.Root>
