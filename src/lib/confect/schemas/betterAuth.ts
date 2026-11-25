import type { GenericId } from 'convex/values';
import * as Schema from 'effect/Schema';

export const BetterAuthUserId = Schema.String.pipe(
	Schema.refine((_value: string): _value is GenericId<'user'> => true),
	Schema.toType
);

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
