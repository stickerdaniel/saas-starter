import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { EmailEvent } from '../schemas/resend';

export default Table.make(() =>
	Schema.Struct({
		emailId: Schema.String,
		eventType: Schema.String,
		timestamp: Schema.Number,
		data: EmailEvent
	})
).index('by_email_id', ['emailId']);
