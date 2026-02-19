<script lang="ts">
	import * as Chart from '$lib/components/ui/chart/index.js';
	import type { ChartConfig } from '$lib/components/ui/chart/index.js';
	import { ArcChart, Text } from 'layerchart';

	interface Props {
		value: number;
		target: number;
		colorClass?: string;
		loading?: boolean;
	}

	let { value, target, colorClass = 'text-emerald-500', loading = false }: Props = $props();

	let percent = $derived(target > 0 ? Math.round(Math.max(0, (value / target) * 100)) : 0);

	let data = $derived([{ key: 'progress', value: percent }]);

	const config: ChartConfig = {
		progress: { label: 'Progress', color: 'var(--chart-1)' }
	};
</script>

<Chart.Container {config} class="mx-auto aspect-square max-h-[150px]">
	{#if !loading}
		<ArcChart
			{data}
			value="value"
			range={[90, -270]}
			outerRadius={-20}
			innerRadius={-12}
			cornerRadius={20}
			maxValue={100}
		>
			{#snippet aboveMarks()}
				<circle cx={0} cy={0} r={-20 + 52} class="fill-background" />
				<Text
					x={0}
					y={-4}
					textAnchor="middle"
					dominantBaseline="middle"
					class={colorClass}
					style="font-size: 1.25rem; font-weight: 700;"
					value="{percent}%"
				/>
				<Text
					x={0}
					y={16}
					textAnchor="middle"
					dominantBaseline="middle"
					class="fill-muted-foreground"
					style="font-size: 0.65rem;"
					value="{value}/{target}"
				/>
			{/snippet}
		</ArcChart>
	{/if}
</Chart.Container>
