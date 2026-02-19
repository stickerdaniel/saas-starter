<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import MetricCard from '$lib/components/ui/metric-card.svelte';
	import ProgressRadial from '$lib/admin/components/progress-radial.svelte';
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
	type MetricCardData =
		| MetricValueCard
		| MetricTrendCard
		| MetricPartitionCard
		| MetricProgressCard
		| MetricTableCard;

	type Props = {
		metrics: MetricDefinition[];
		values: MetricCardData[];
		selectedRanges?: Record<string, string>;
		onRangeChange?: (metricKey: string, value: string) => void;
		prefix: string;
		error?: boolean;
		animated?: boolean;
	};

	let {
		metrics,
		values,
		selectedRanges = {},
		onRangeChange = () => {},
		prefix,
		error = false,
		animated = true
	}: Props = $props();

	const { t } = getTranslate();

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

	function getProgressPercent(value: number, target: number) {
		if (target <= 0) return 0;
		return Math.max(0, Math.round((value / target) * 100));
	}

	function getProgressColorClass(percent: number, avoid?: boolean) {
		if (avoid) {
			if (percent >= 75) return 'bg-destructive text-destructive';
			if (percent >= 50) return 'bg-amber-500 text-amber-500';
			return 'bg-emerald-500 text-emerald-500';
		}
		if (percent < 50) return 'bg-destructive text-destructive';
		if (percent < 75) return 'bg-amber-500 text-amber-500';
		return 'bg-emerald-500 text-emerald-500';
	}

	function totalSegments(segments: Array<{ value: number }>) {
		return segments.reduce((sum, segment) => sum + segment.value, 0);
	}
</script>

{#snippet rangeSelector(metric: MetricDefinition)}
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
{/snippet}

{#if metrics.length > 0}
	{#if error}
		<div
			class="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
			data-testid={`${prefix}-metrics-error`}
		>
			<T keyName="admin.resources.metrics_load_error" />
		</div>
	{/if}
	<div
		class="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs md:grid-cols-2 xl:grid-cols-4 dark:*:data-[slot=card]:bg-card"
		data-testid={`${prefix}-metrics`}
	>
		{#each metrics as metric (metric.key)}
			{#if metric.type === 'value'}
				<MetricCard
					label={$t(metric.labelKey)}
					value={formatValue(getValue(metric.key), metric.format)}
					icon={metric.icon}
					description={metric.descriptionKey ? $t(metric.descriptionKey) : undefined}
					subtitle={metric.subtitleKey ? $t(metric.subtitleKey) : undefined}
					loading={values.length === 0}
					{animated}
				>
					{#snippet headerAction()}
						{@render rangeSelector(metric)}
					{/snippet}
				</MetricCard>
			{:else if metric.type === 'progress'}
				{@const card = getMetric(metric.key)}
				{@const pCard = card?.type === 'progress' ? card : undefined}
				{@const pPercent = pCard ? getProgressPercent(pCard.value, pCard.target) : 0}
				{@const pColor = getProgressColorClass(pPercent, metric.avoid)}
				<MetricCard
					label={$t(metric.labelKey)}
					value="{pPercent}%"
					icon={metric.icon}
					description={metric.descriptionKey ? $t(metric.descriptionKey) : undefined}
					subtitle={metric.subtitleKey ? $t(metric.subtitleKey) : undefined}
					loading={values.length === 0}
					{animated}
				>
					{#snippet headerAction()}
						{@render rangeSelector(metric)}
					{/snippet}
					{#snippet footer()}
						{#if pCard}
							{#if metric.display === 'radial'}
								<ProgressRadial
									value={pCard.value}
									target={pCard.target}
									colorClass={pColor.split(' ').find((c) => c.startsWith('text-')) ??
										'text-emerald-500'}
									loading={values.length === 0}
								/>
							{:else}
								<div class="w-full space-y-1.5">
									<Progress
										value={pCard.value}
										max={pCard.target}
										indicatorClass={pColor.split(' ').find((c) => c.startsWith('bg-'))}
									/>
									<p class="text-xs text-muted-foreground">
										{pCard.value}/{pCard.target}
									</p>
								</div>
							{/if}
						{/if}
					{/snippet}
				</MetricCard>
			{:else}
				<Card.Root class="@container/card" data-slot="card">
					<Card.Header class="pb-2">
						<div class="flex items-center justify-between gap-2">
							<Card.Description><T keyName={metric.labelKey} /></Card.Description>
							{@render rangeSelector(metric)}
						</div>
						<Card.Title class="text-2xl tabular-nums">
							{formatValue(getValue(metric.key), metric.format)}
						</Card.Title>
					</Card.Header>
					<Card.Content>
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
					</Card.Content>
				</Card.Root>
			{/if}
		{/each}
	</div>
{/if}
