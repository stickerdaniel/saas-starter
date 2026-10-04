<script lang="ts">
	import type { ColumnDef } from '@tanstack/table-core';
	import { getTranslate } from '@tolgee/svelte';
	import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';
	import type { DataTableFeatures } from '$lib/components/ui/data-table/data-table.svelte.ts';
	import {
		createSvelteTable,
		FlexRender,
		renderComponent
	} from '$lib/components/ui/data-table/index.js';
	import { createRowSelection } from '$lib/components/ui/data-table/row-selection.svelte.ts';
	import RecipientsToggle from '../recipients-toggle.svelte';
	import {
		setRecipientsContext,
		setRowSelectionContext,
		setTogglePreferenceContext,
		type ToggleField
	} from '../recipients-context';
	import SelectionProbe from './SelectionProbe.svelte';

	let {
		recipients: initialRecipients,
		onToggle
	}: {
		recipients: NotificationRecipient[];
		onToggle: (email: string, field: ToggleField, currentValue: boolean) => Promise<void>;
	} = $props();

	const { t } = getTranslate();

	// The initial rows are fixed per mount; tests replace them through `setRecipients`.
	// svelte-ignore state_referenced_locally
	let recipients = $state.raw(initialRecipients);

	// Wired like notification-recipients-table.svelte.
	const rowSelection = createRowSelection(() => recipients.map((recipient) => recipient.email));
	// svelte-ignore state_referenced_locally
	setTogglePreferenceContext(onToggle);
	setRowSelectionContext(() => rowSelection.state);
	setRecipientsContext(() => recipients);

	const columns: Array<ColumnDef<DataTableFeatures, NotificationRecipient>> = [
		{
			id: 'notifyNewSignups',
			cell: ({ row }) =>
				renderComponent(RecipientsToggle, {
					email: row.original.email,
					field: 'notifyNewSignups',
					checked: row.original.notifyNewSignups
				})
		}
	];

	const table = createSvelteTable({
		get data() {
			return recipients;
		},
		columns,
		state: {
			get rowSelection() {
				return rowSelection.state;
			}
		},
		manualPagination: true,
		manualFiltering: true,
		manualSorting: true,
		getRowId: (row) => row.email,
		onRowSelectionChange: rowSelection.onChange
	});

	export function selectPage() {
		table.toggleAllPageRowsSelected(true);
	}
	export function setRecipients(next: NotificationRecipient[]) {
		recipients = next;
	}
</script>

<SelectionProbe />
<p data-testid="footer">
	{$t('admin.settings.selected', { selected: rowSelection.count, total: recipients.length })}
</p>
<table>
	<tbody>
		{#each table.getRowModel().rows as row (row.id)}
			<tr>
				{#each row.getVisibleCells() as cell (cell.id)}
					<td><FlexRender {cell} /></td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>
