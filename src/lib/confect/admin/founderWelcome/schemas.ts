import * as Schema from 'effect/Schema';

export const SwitchableFounderEmailSchema = Schema.Literals(['feedback', 'cancellation']);

export const FounderWelcomeConfigSchema = Schema.Union([
	Schema.Struct({
		enabled: Schema.Literal(true),
		contactUser: Schema.Struct({
			id: Schema.String,
			name: Schema.String,
			email: Schema.String
		}),
		name: Schema.String,
		title: Schema.String,
		subject: Schema.String,
		body: Schema.String,
		replyTo: Schema.String
	}),
	Schema.Struct({ enabled: Schema.Literal(false) })
]);

export const FounderWelcomeAdminConfigSchema = Schema.Struct({
	config: FounderWelcomeConfigSchema,
	viewerProfile: Schema.Struct({
		name: Schema.String,
		title: Schema.String,
		replyTo: Schema.String
	})
});

const SwitchableEmailSettingsSchema = Schema.Struct({
	on: Schema.Boolean,
	subject: Schema.String,
	body: Schema.String
});

export const FounderEmailSettingsSchema = Schema.Struct({
	sender: Schema.Union([Schema.Null, Schema.Struct({ name: Schema.String, title: Schema.String })]),
	canEdit: Schema.Boolean,
	feedback: SwitchableEmailSettingsSchema,
	cancellation: SwitchableEmailSettingsSchema
});
