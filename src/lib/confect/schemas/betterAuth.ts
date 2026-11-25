import * as Schema from 'effect/Schema';

const optionalNullable = <S extends Schema.Top>(schema: S) =>
	Schema.optional(Schema.Union([Schema.Null, schema]));

export const BetterAuthUserSchema = Schema.Struct({
	name: Schema.String,
	email: Schema.String,
	emailVerified: Schema.Boolean,
	image: optionalNullable(Schema.String),
	createdAt: Schema.Number,
	updatedAt: Schema.Number,
	userId: optionalNullable(Schema.String),
	role: optionalNullable(Schema.String),
	banned: optionalNullable(Schema.Boolean),
	banReason: optionalNullable(Schema.String),
	banExpires: optionalNullable(Schema.Number),
	locale: optionalNullable(Schema.String)
});
