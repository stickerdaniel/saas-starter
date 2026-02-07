<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import data from './data.js';
	import SectionCards from '$lib/components/section-cards.svelte';
	import ChartAreaInteractive from '$lib/components/chart-area-interactive.svelte';
	import DataTable from '$lib/components/data-table.svelte';

	const { t } = getTranslate();
</script>

<SEOHead
	title={$t('meta.app.dashboard.title')}
	description={$t('meta.app.dashboard.description')}
/>

<SectionCards />
<div class="px-4 lg:px-6">
	<ChartAreaInteractive />
</div>
<DataTable {data} />
