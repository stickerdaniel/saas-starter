<script lang="ts">
	import type { ColumnDef } from '@tanstack/table-core';
	import { getTranslate } from '@tolgee/svelte';
	import type { NotificationRecipient } from '#lib/convex/admin/notificationPreferences/queries.js';
	import type { DataTableFeatures } from '#lib/components/ui/data-table/data-table.svelte.ts';
	import {
		createSvelteTable,
		FlexRender,
		renderComponent
	} from '#lib/components/ui/data-table/index.js';
	import { createRowSelection } from '#lib/components/ui/data-table/row-selection.svelte.ts';
	import RecipientsToggle from '../recipients-toggle.svelte';
	import {
		setPreferenceForManyContext,
		setRecipientsContext,
		setRowSelectionContext,
		setTogglePreferenceContext,
		type ToggleField
	} from '../recipients-context';
	import SelectionProbe from './SelectionProbe.svelte';

	let {
		recipients: initialRecipients,
		failingEmail,
		onToggleMany
	}: {
		recipients: NotificationRecipient[];
		/** The backend refuses this email, for example because it became dormant. */
		failingEmail?: string;
		onToggleMany?: (emails: string[], field: ToggleField, value: boolean) => void;
	} = $props();

	const { t } = getTranslate();

	// The initial rows are fixed per mount; toggles and `setRecipients` replace them.
	// svelte-ignore state_referenced_locally
	let recipients = $state.raw(initialRecipients);

	function write(email: string, field: ToggleField, value: boolean) {
		recipients = recipients.map((recipient) =>
			recipient.email === email ? { ...recipient, [field]: value } : recipient
		);
	}

	// Wired like notification-recipients-table.svelte, with the backend's write rules:
	// one row per call, or a whole batch at once.
	const rowSelection = createRowSelection(() => recipients.map((recipient) => recipient.email));
	setTogglePreferenceContext(async (email, field, currentValue) => {
		if (email === failingEmail) throw new Error(`Refused ${email}`);
		write(email, field, !currentValue);
	});
	setPreferenceForManyContext(async (emails, field, value) => {
		onToggleMany?.(emails, field, value);
		if (failingEmail !== undefined && emails.includes(failingEmail)) {
			throw new Error(`Refused ${failingEmail}`);
		}
		for (const email of emails) write(email, field, value);
	});
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
	export function getRecipients() {
		return recipients;
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
