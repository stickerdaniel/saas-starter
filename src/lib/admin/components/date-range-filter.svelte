<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { RangeCalendar } from '$lib/components/ui/range-calendar/index.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { CalendarDate, getLocalTimeZone } from '@internationalized/date';
	import type { DateRange } from 'bits-ui';
	import { T } from '@tolgee/svelte';

	type Props = {
		labelKey: string;
		value: string;
		testId?: string;
		onChange: (serialized: string) => void;
	};

	let { labelKey, value, testId, onChange }: Props = $props();
	let open = $state(false);

	const dateRange: DateRange | undefined = $derived.by(() => {
		if (!value || !value.includes('..')) return undefined;
		const [startStr, endStr] = value.split('..');
		if (!startStr || !endStr) return undefined;
		const [sy, sm, sd] = startStr.split('-').map((entry) => Number.parseInt(entry, 10));
		const [ey, em, ed] = endStr.split('-').map((entry) => Number.parseInt(entry, 10));
		if (!sy || !sm || !sd || !ey || !em || !ed) return undefined;
		return {
			start: new CalendarDate(sy, sm, sd),
			end: new CalendarDate(ey, em, ed)
		};
	});

	function handleChange(next: DateRange | undefined) {
		if (!next?.start || !next?.end) {
			onChange('');
			return;
		}
		const pad = (n: number) => String(n).padStart(2, '0');
		const fmt = (d: typeof next.start) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;
		onChange(`${fmt(next.start)}..${fmt(next.end)}`);
	}

	const displayText = $derived.by(() => {
		if (!dateRange?.start || !dateRange?.end) return '';
		const start = dateRange.start.toDate(getLocalTimeZone()).toLocaleDateString();
		const end = dateRange.end.toDate(getLocalTimeZone()).toLocaleDateString();
		return `${start} - ${end}`;
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger data-testid={testId}>
		{#snippet child({ props })}
			<Button {...props} variant="outline" class="min-w-56 justify-between font-normal">
				{#if displayText}
					{displayText}
				{:else}
					<T keyName={labelKey} />
				{/if}
				<ChevronDownIcon class="ml-2 size-4" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-auto overflow-hidden p-0" align="start">
		<RangeCalendar
			value={dateRange}
			onValueChange={(next) => {
				handleChange(next);
				if (next?.start && next?.end) {
					open = false;
				}
			}}
			captionLayout="dropdown"
		/>
	</Popover.Content>
</Popover.Root>
