<script lang="ts">
	import { T } from '@tolgee/svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import type { MetricDefinition } from '$lib/admin/types';

	type MetricCard = {
		key: string;
		type: string;
		value: number;
	};

	type Props = {
		metrics: MetricDefinition[];
		values: MetricCard[];
		prefix: string;
	};

	let { metrics, values, prefix }: Props = $props();

	function getValue(metricKey: string) {
		return values.find((value) => value.key === metricKey)?.value ?? 0;
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
					<CardDescription><T keyName={metric.labelKey} /></CardDescription>
					<CardTitle class="text-2xl">{getValue(metric.key)}</CardTitle>
				</CardHeader>
				<CardContent />
			</Card>
		{/each}
	</div>
{/if}
