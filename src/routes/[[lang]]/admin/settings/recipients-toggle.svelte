<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { getTranslate } from '@tolgee/svelte';
	import type { RowSelectionState } from '@tanstack/table-core';
	import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';

	type ToggleField = 'notifyNewSupportTickets' | 'notifyUserReplies' | 'notifyNewSignups';

	interface Props {
		email: string;
		field: ToggleField;
		checked: boolean;
	}

	let { email, field, checked }: Props = $props();

	const { t } = getTranslate();

	// Get the toggle handler from context (provided by the table)
	const onToggle =
		getContext<(email: string, field: ToggleField, currentValue: boolean) => Promise<void>>(
			'onTogglePreference'
		);

	// Get selection state and recipients for bulk operations
	const getRowSelection = getContext<() => RowSelectionState>('getRowSelection');
	const getRecipients = getContext<() => NotificationRecipient[]>('getRecipients');

	// Map field to translation key
	const fieldTranslationKeys: Record<ToggleField, string> = {
		notifyNewSupportTickets: 'admin.settings.field_new_tickets',
		notifyUserReplies: 'admin.settings.field_user_replies',
		notifyNewSignups: 'admin.settings.field_new_signups'
	};

	function handleToggle() {
		const newValue = !checked;
		const fieldName = $t(fieldTranslationKeys[field]);
		const rowSelection = getRowSelection();
		const selectedEmails = Object.keys(rowSelection).filter((key) => rowSelection[key]);

		// Bulk toggle if 2+ rows selected and this row is one of them
		if (selectedEmails.length >= 2 && selectedEmails.includes(email)) {
			const recipients = getRecipients();

			// Build promises for all selected rows, setting them to the new value
			const promises = selectedEmails.map((selectedEmail) => {
				const recipient = recipients.find((r) => r.email === selectedEmail);
				if (recipient) {
					// Only toggle if current value differs from target
					const currentValue = recipient[field];
					if (currentValue !== newValue) {
						return onToggle(selectedEmail, field, currentValue);
					}
				}
				return Promise.resolve();
			});

			toast.promise(Promise.all(promises), {
				loading: newValue
					? $t('admin.settings.preference_enabling', { field: fieldName })
					: $t('admin.settings.preference_disabling', { field: fieldName }),
				success: newValue
					? $t('admin.settings.preference_enabled', { field: fieldName })
					: $t('admin.settings.preference_disabled', { field: fieldName }),
				error: $t('admin.settings.preference_update_failed')
			});
		} else {
			// Single row toggle
			toast.promise(onToggle(email, field, checked), {
				loading: newValue
					? $t('admin.settings.preference_enabling', { field: fieldName })
					: $t('admin.settings.preference_disabling', { field: fieldName }),
				success: newValue
					? $t('admin.settings.preference_enabled', { field: fieldName })
					: $t('admin.settings.preference_disabled', { field: fieldName }),
				error: $t('admin.settings.preference_update_failed')
			});
		}
	}
</script>

<div class="flex items-center justify-center">
	<Checkbox
		{checked}
		onCheckedChange={handleToggle}
		aria-label={$t('aria.notification_toggle_for_email', {
			field: $t(fieldTranslationKeys[field]),
			email
		})}
		data-testid="toggle-{field}-{email}"
	/>
</div>
