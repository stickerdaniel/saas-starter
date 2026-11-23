import { SchemaToValidator } from '@confect/core';
import * as Schema from 'effect/Schema';
import { USER_ROLES } from './types';

export const RoleSchema = Schema.Literals(USER_ROLES);

export const AdminUserDataSchema = Schema.Struct({
	id: Schema.String,
	name: Schema.optionalKey(Schema.String),
	email: Schema.String,
	emailVerified: Schema.optionalKey(Schema.Boolean),
	image: Schema.optionalKey(Schema.NullOr(Schema.String)),
	role: RoleSchema,
	banned: Schema.Boolean,
	banReason: Schema.optionalKey(Schema.NullOr(Schema.String)),
	banExpires: Schema.optionalKey(Schema.NullOr(Schema.Number)),
	providers: Schema.Array(Schema.String),
	createdAt: Schema.optionalKey(Schema.Number),
	updatedAt: Schema.optionalKey(Schema.Number)
});

export const adminUserDataValidator = SchemaToValidator.compileSchema(AdminUserDataSchema);
