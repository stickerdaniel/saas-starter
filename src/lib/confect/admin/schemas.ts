import * as Schema from 'effect/Schema';
import { USER_ROLES } from './types';

export const RoleSchema = Schema.Literals(USER_ROLES);

export const AdminUserDataSchema = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	email: Schema.String,
	emailVerified: Schema.optional(Schema.Boolean),
	image: Schema.optional(Schema.NullOr(Schema.String)),
	role: RoleSchema,
	banned: Schema.Boolean,
	banReason: Schema.optional(Schema.NullOr(Schema.String)),
	banExpires: Schema.optional(Schema.NullOr(Schema.Number)),
	providers: Schema.mutable(Schema.Array(Schema.String)),
	createdAt: Schema.optional(Schema.Number),
	updatedAt: Schema.optional(Schema.Number)
});

export const UserSortSchema = Schema.Struct({
	field: Schema.Literals(['createdAt', 'email', 'name', 'role', 'provider']),
	direction: Schema.Literals(['asc', 'desc'])
});

const userFilterFields = {
	search: Schema.optionalKey(Schema.String),
	roleFilter: Schema.optionalKey(Schema.Literals(['admin', 'user'])),
	statusFilter: Schema.optionalKey(Schema.Literals(['verified', 'unverified', 'banned'])),
	providerFilter: Schema.optionalKey(Schema.Literals(['credential', 'google', 'github', 'passkey']))
};

export const UserCountArgsSchema = Schema.Struct(userFilterFields);

export const ListUsersArgsSchema = Schema.Struct({
	cursor: Schema.optionalKey(Schema.String),
	numItems: Schema.Number,
	...userFilterFields,
	sortBy: Schema.optionalKey(UserSortSchema)
});

export const UsersLastPageArgsSchema = Schema.Struct({
	numItems: Schema.Number,
	...userFilterFields,
	sortBy: Schema.optionalKey(UserSortSchema)
});
