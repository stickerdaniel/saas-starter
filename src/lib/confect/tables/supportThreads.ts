import { Table } from '@confect/core';
import { SupportThreadSchema } from '../support/supportThreadFields';

export default Table.make(() => SupportThreadSchema)
	.index('by_thread', ['threadId'])
	.index('by_user_warm', ['userId', 'isWarm'])
	.index('by_user_and_last_message', ['userId', 'lastMessageAt'])
	.index('by_user_and_first_user_message', ['userId', 'firstUserMessageAt'])
	.index('by_user_and_unread_admin_reply', ['userId', 'hasUnreadAdminReply'])
	.index('by_handed_off_updated', ['isHandedOff', 'updatedAt'])
	.index('by_handed_off_assigned_updated', ['isHandedOff', 'assignedTo', 'updatedAt'])
	.index('by_handed_off_status_updated', ['isHandedOff', 'status', 'updatedAt'])
	.index('by_handed_off_status_assigned_updated', [
		'isHandedOff',
		'status',
		'assignedTo',
		'updatedAt'
	])
	.index('by_needs_response', ['isHandedOff', 'status', 'awaitingAdminResponse'])
	.index('by_sweep', ['sweep'])
	.searchIndex('search_all', {
		searchField: 'searchText',
		filterFields: ['status', 'assignedTo', 'isHandedOff', 'awaitingAdminResponse']
	});
