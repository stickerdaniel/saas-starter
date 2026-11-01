<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
	import { toast } from 'svelte-sonner';
	import { getTranslate } from '@tolgee/svelte';
	import {
		getTogglePreferenceContext,
		getPreferenceForManyContext,
		getRowSelectionContext,
		getRecipientsContext,
		type ToggleField
	} from './recipients-context';

	interface Props {
		email: string;
		field: ToggleField;
		checked: boolean;
	}

	let { email, field, checked }: Props = $props();

	const { t } = getTranslate();

	// Get the toggle handlers from context (provided by the table)
	const onToggle = getTogglePreferenceContext();
	const setPreferenceForMany = getPreferenceForManyContext();

	// Get selection state and recipients for bulk operations
	const getRowSelection = getRowSelectionContext();
	const getRecipients = getRecipientsContext();

	// Map field to translation key
	const fieldTranslationKeys: Record<ToggleField, string> = {
		notifyNewSupportTickets: 'admin.settings.field_new_tickets',
		notifyUserReplies: 'admin.settings.field_user_replies',
		notifyNewSignups: 'admin.settings.field_new_signups',
		notifyNewCustomers: 'admin.settings.field_new_customers',
		notifyCancellations: 'admin.settings.field_cancellations'
	};

	function handleToggle() {
		haptic.trigger('selection');
		const newValue = !checked;
		const fieldName = $t(fieldTranslationKeys[field]);
		const rowSelection = getRowSelection();
		const selectedEmails = Object.keys(rowSelection).filter((key) => rowSelection[key]);

		// Bulk toggle if 2+ rows selected and this row is one of them
		const update =
			selectedEmails.length >= 2 && selectedEmails.includes(email)
				? setPreferenceForMany(changedEmails(selectedEmails, newValue), field, newValue)
				: onToggle(email, field, checked);

		toast.promise(update, {
			loading: newValue
				? $t('admin.settings.preference_enabling', { field: fieldName })
				: $t('admin.settings.preference_disabling', { field: fieldName }),
			success: newValue
				? $t('admin.settings.preference_enabled', { field: fieldName })
				: $t('admin.settings.preference_disabled', { field: fieldName }),
			error: $t('admin.settings.preference_update_failed')
		});
	}

	// Selected emails whose listed row does not hold the target value yet
	function changedEmails(selectedEmails: string[], newValue: boolean) {
		const recipients = getRecipients();
		return selectedEmails.filter((selectedEmail) => {
			const recipient = recipients.find((r) => r.email === selectedEmail);
			return recipient !== undefined && recipient[field] !== newValue;
		});
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
