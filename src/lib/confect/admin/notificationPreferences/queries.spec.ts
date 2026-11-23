import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import RequireAdmin from '../../middleware/RequireAdmin.spec';
import {
	ListRecipientsArgsSchema,
	NotificationRecipientSchema,
	NotificationTypeSchema,
	RecipientCountArgsSchema,
	RecipientsLastPageArgsSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getJourneyRecipients',
			args: () => ({ type: NotificationTypeSchema }),
			returns: () =>
				Schema.Struct({
					emails: Schema.mutable(Schema.Array(Schema.String)),
					truncated: Schema.Boolean
				})
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getNotificationRecipientCount',
			args: () => RecipientCountArgsSchema.fields,
			returns: () => Schema.Number
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getRecipientsForNotificationType',
			args: () => ({ type: NotificationTypeSchema }),
			returns: () => Schema.mutable(Schema.Array(Schema.String))
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listNotificationRecipients',
			args: () => ListRecipientsArgsSchema.fields,
			returns: () =>
				Schema.Struct({
					items: Schema.mutable(Schema.Array(NotificationRecipientSchema)),
					continueCursor: Schema.NullOr(Schema.String),
					isDone: Schema.Boolean
				})
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'resolveNotificationRecipientsLastPage',
			args: () => RecipientsLastPageArgsSchema.fields,
			returns: () => Schema.Struct({ page: Schema.Number, cursor: Schema.NullOr(Schema.String) })
		}).middleware(RequireAdmin)
	);
