import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { NotificationPreferenceRefusalCodec } from '../../errorCodecs';
import RequireAdmin from '../../middleware/RequireAdmin.spec';
import { PreferenceBatchArgsSchema, PreferenceToggleArgsSchema } from './schemas';

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
		FunctionSpec.publicMutation({
			name: 'removeCustomEmail',
			args: () => ({ email: Schema.String }),
			returns: () => Schema.Null,
			error: () => NotificationPreferenceRefusalCodec
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
