import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { NotificationPreferenceRefusalCodec } from '../../errorCodecs';
import RequireAdmin from '../../middleware/RequireAdmin.spec';
import {
	ListRecipientsArgsSchema,
	NotificationRecipientSchema,
	NotificationTypeSchema,
	PreferenceBatchArgsSchema,
	PreferenceToggleArgsSchema,
	RecipientCountArgsSchema,
	RecipientsLastPageArgsSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'addCustomEmail',
			args: () => ({ email: Schema.String }),
			returns: () => Schema.Null,
			error: () => NotificationPreferenceRefusalCodec
		}).middleware(RequireAdmin)
	)
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
		FunctionSpec.publicMutation({
			name: 'removeCustomEmail',
			args: () => ({ email: Schema.String }),
			returns: () => Schema.Null,
			error: () => NotificationPreferenceRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'resolveNotificationRecipientsLastPage',
			args: () => RecipientsLastPageArgsSchema.fields,
			returns: () => Schema.Struct({ page: Schema.Number, cursor: Schema.NullOr(Schema.String) })
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'syncAllAdminPreferences',
			args: () => ({}),
			returns: () => Schema.Struct({ synced: Schema.Number, skipped: Schema.Number })
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'updatePreference',
			args: () => PreferenceToggleArgsSchema.fields,
			returns: () => Schema.Null,
			error: () => NotificationPreferenceRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'updatePreferences',
			args: () => PreferenceBatchArgsSchema.fields,
			returns: () => Schema.Null,
			error: () => NotificationPreferenceRefusalCodec
		}).middleware(RequireAdmin)
	);
