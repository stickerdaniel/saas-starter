<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import type { MetricDefinition } from '$lib/admin/types';

	type MetricValueCard = {
		key: string;
		type: 'value';
		value: number;
	};
	type MetricTrendCard = {
		key: string;
		type: 'trend';
		points: Array<{ label?: string; labelKey?: string; value: number }>;
	};
	type MetricPartitionCard = {
		key: string;
		type: 'partition';
		segments: Array<{ label?: string; labelKey?: string; value: number }>;
	};
	type MetricProgressCard = {
		key: string;
		type: 'progress';
		value: number;
		target: number;
	};
	type MetricTableCard = {
		key: string;
		type: 'table';
		rows: Array<{ label?: string; labelKey?: string; value: number | string }>;
	};
	type MetricCard =
		| MetricValueCard
		| MetricTrendCard
		| MetricPartitionCard
		| MetricProgressCard
		| MetricTableCard;

	type Props = {
		metrics: MetricDefinition[];
		values: MetricCard[];
		selectedRanges?: Record<string, string>;
		onRangeChange?: (metricKey: string, value: string) => void;
		prefix: string;
	};

	let { metrics, values, selectedRanges = {}, onRangeChange = () => {}, prefix }: Props = $props();

	function getMetric(metricKey: string) {
		return values.find((value) => value.key === metricKey);
	}

	function getValue(metricKey: string) {
		const metric = getMetric(metricKey);
		if (!metric) return 0;
		if ('value' in metric && typeof metric.value === 'number') return metric.value;
		return 0;
	}

	function formatValue(value: number, format: MetricDefinition['format']) {
		if (format === 'currency') {
			return new Intl.NumberFormat(undefined, {
				style: 'currency',
				currency: 'USD',
				maximumFractionDigits: 2
			}).format(value);
		}
		if (format === 'percent') {
			const normalized = Math.abs(value) > 1 ? value / 100 : value;
			return new Intl.NumberFormat(undefined, {
				style: 'percent',
				maximumFractionDigits: 1
			}).format(normalized);
		}
		return new Intl.NumberFormat().format(value);
	}

	function formatPercent(value: number, target: number) {
		if (target <= 0) return '0%';
		return `${Math.round((value / target) * 100)}%`;
	}

	function totalSegments(segments: Array<{ value: number }>) {
		return segments.reduce((sum, segment) => sum + segment.value, 0);
	}
</script>

{#if metrics.length > 0}
	<div
		class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
		data-testid={`${prefix}-metrics`}
	>
		{#each metrics as metric (metric.key)}
			<Card>
				<CardHeader class="pb-2">
					<div class="flex items-center justify-between gap-2">
						<CardDescription><T keyName={metric.labelKey} /></CardDescription>
						{#if (metric.rangeOptions?.length ?? 0) > 0}
							<Select.Root
								type="single"
								value={selectedRanges[metric.key] ?? metric.rangeOptions?.[0]?.value ?? ''}
								onValueChange={(value) => onRangeChange(metric.key, value)}
							>
								<Select.Trigger
									class="h-8 min-w-28 text-xs"
									data-testid={`${prefix}-metric-${metric.key}-range`}
								>
									{#each metric.rangeOptions ?? [] as option (option.value)}
										{#if option.value === (selectedRanges[metric.key] ?? metric.rangeOptions?.[0]?.value ?? '')}
											<T keyName={option.labelKey} />
										{/if}
									{/each}
								</Select.Trigger>
								<Select.Content>
									{#each metric.rangeOptions ?? [] as option (option.value)}
										<Select.Item value={option.value}>
											<T keyName={option.labelKey} />
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						{/if}
					</div>
					<CardTitle class="text-2xl">{formatValue(getValue(metric.key), metric.format)}</CardTitle>
				</CardHeader>
				<CardContent>
					{@const card = getMetric(metric.key)}
					{#if card?.type === 'trend'}
						<div class="space-y-2 text-xs text-muted-foreground">
							{#each card.points as point, index (`point-${index}`)}
								<div class="flex items-center justify-between">
									<span>
										{#if point.labelKey}
											<T keyName={point.labelKey} />
										{:else}
											{point.label ?? `#${index + 1}`}
										{/if}
									</span>
									<span>{point.value}</span>
								</div>
							{/each}
						</div>
					{:else if card?.type === 'partition'}
						{@const total = totalSegments(card.segments)}
						<div class="space-y-2 text-xs">
							{#each card.segments as segment, index (`seg-${index}`)}
								<div class="flex items-center justify-between">
									<span class="text-muted-foreground">
										{#if segment.labelKey}
											<T keyName={segment.labelKey} />
										{:else}
											{segment.label ?? `#${index + 1}`}
										{/if}
									</span>
									<span>{segment.value} ({formatPercent(segment.value, total)})</span>
								</div>
							{/each}
						</div>
					{:else if card?.type === 'progress'}
						<div class="space-y-2">
							<Progress value={card.value} max={card.target} />
							<p class="text-xs text-muted-foreground">
								{card.value}/{card.target} ({formatPercent(card.value, card.target)})
							</p>
						</div>
					{:else if card?.type === 'table'}
						<div class="space-y-2 text-xs">
							{#each card.rows as row, index (`row-${index}`)}
								<div class="flex items-center justify-between">
									<span class="text-muted-foreground">
										{#if row.labelKey}
											<T keyName={row.labelKey} />
										{:else}
											{row.label ?? `#${index + 1}`}
										{/if}
									</span>
									<span>{row.value}</span>
								</div>
							{/each}
						</div>
					{/if}
				</CardContent>
			</Card>
		{/each}
	</div>
{/if}
