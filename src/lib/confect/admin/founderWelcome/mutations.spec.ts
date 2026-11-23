import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { FounderWelcomeRefusalCodec } from '../../errorCodecs';
import RequireAdmin from '../../middleware/RequireAdmin.spec';
import { SwitchableFounderEmailSchema } from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'setFounderEmailEnabled',
			args: () => ({ email: SwitchableFounderEmailSchema, enabled: Schema.Boolean }),
			returns: () => Schema.Null,
			error: () => FounderWelcomeRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'stepDown',
			args: () => ({}),
			returns: () => Schema.Null,
			error: () => FounderWelcomeRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'updateConfig',
			args: () => ({
				name: Schema.String,
				title: Schema.String,
				subject: Schema.String,
				body: Schema.String,
				replyTo: Schema.optionalKey(Schema.String)
			}),
			returns: () => Schema.Null,
			error: () => FounderWelcomeRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'updateFounderEmailTemplate',
			args: () => ({
				email: SwitchableFounderEmailSchema,
				subject: Schema.String,
				body: Schema.String
			}),
			returns: () => Schema.Null,
			error: () => FounderWelcomeRefusalCodec
		}).middleware(RequireAdmin)
	);
