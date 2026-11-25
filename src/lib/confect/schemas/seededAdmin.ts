import * as Schema from 'effect/Schema';

export const SeededAdminSchema = Schema.Struct({
	created: Schema.Boolean,
	updatedRole: Schema.Boolean,
	updatedVerification: Schema.Boolean,
	skipped: Schema.Boolean
});
