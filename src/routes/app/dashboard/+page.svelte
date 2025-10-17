<script lang="ts">
	import data from './data.js';
	import SectionCards from '$lib/components/section-cards.svelte';
	import ChartAreaInteractive from '$lib/components/chart-area-interactive.svelte';
	import DataTable from '$lib/components/data-table.svelte';
</script>

<SectionCards />
<div class="px-4 lg:px-6">
	<ChartAreaInteractive />
</div>
<DataTable {data} />
