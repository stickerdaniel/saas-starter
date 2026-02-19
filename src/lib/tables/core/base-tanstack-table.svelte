<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { BaseTableRenderConfig } from './types';
	import BaseTableRenderer from './base-table-renderer.svelte';

	type Props = {
		table: any;
		config: BaseTableRenderConfig;
		toolbarFilters?: Snippet;
		toolbarActions?: Snippet;
		rowTestId?: (row: any) => string;
		onRowClick?: (row: any, event: MouseEvent) => void;
		onRowHover?: (row: any) => void;
	};

	let { table, config, toolbarFilters, toolbarActions, rowTestId, onRowClick, onRowHover }: Props =
		$props();
</script>

<BaseTableRenderer
	{table}
	{config}
	{toolbarFilters}
	{toolbarActions}
	{rowTestId}
	{onRowClick}
	{onRowHover}
/>
