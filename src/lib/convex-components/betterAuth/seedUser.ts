import * as Schema from 'effect/Schema';

const SeedUser = Schema.Struct({
	_id: Schema.String,
	email: Schema.String,
	role: Schema.optional(Schema.NullOr(Schema.String)),
	emailVerified: Schema.optional(Schema.NullOr(Schema.Boolean))
});

export type SeedUser = typeof SeedUser.Type;

const decodeSeedUser = Schema.decodeUnknownSync(SeedUser);

/** The Better Auth component's findOne record isn't discriminated by model. */
export function readSeedUser(record: unknown): SeedUser | null {
	return record == null ? null : decodeSeedUser(record);
}
