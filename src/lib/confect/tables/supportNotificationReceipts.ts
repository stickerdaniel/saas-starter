import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export default Table.make(() =>
	Schema.Struct({
		notificationId: Id('pendingAdminNotifications'),
		generation: Schema.String,
		email: Schema.String
	})
).index('by_notificationId_and_generation_and_email', ['notificationId', 'generation', 'email']);
