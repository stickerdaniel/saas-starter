import * as val from 'valibot';

const seedUserSchema = val.object({
	_id: val.string(),
	email: val.string(),
	role: val.optional(val.nullable(val.string())),
	emailVerified: val.optional(val.nullable(val.boolean()))
});

export type SeedUser = val.InferOutput<typeof seedUserSchema>;

/** The Better Auth component's findOne record isn't discriminated by model. */
export function readSeedUser(record: unknown): SeedUser | null {
	return record == null ? null : val.parse(seedUserSchema, record);
}
