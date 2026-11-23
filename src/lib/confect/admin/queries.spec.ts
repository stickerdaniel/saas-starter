import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import RequireAdmin from '../middleware/RequireAdmin.spec';
import {
	AdminUserDataSchema,
	ListUsersArgsSchema,
	UserCountArgsSchema,
	UsersLastPageArgsSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getDashboardMetrics',
			args: () => ({}),
			returns: () =>
				Schema.Struct({
					totalUsers: Schema.Number,
					adminCount: Schema.Number,
					bannedCount: Schema.Number,
					activeIn24h: Schema.Number,
					recentSignups: Schema.Number
				})
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getUserCount',
			args: () => UserCountArgsSchema.fields,
			returns: () => Schema.Number
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listUsers',
			args: () => ListUsersArgsSchema.fields,
			returns: () =>
				Schema.Struct({
					items: Schema.mutable(Schema.Array(AdminUserDataSchema)),
					continueCursor: Schema.NullOr(Schema.String),
					isDone: Schema.Boolean
				})
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'resolveUsersLastPage',
			args: () => UsersLastPageArgsSchema.fields,
			returns: () => Schema.Struct({ page: Schema.Number, cursor: Schema.NullOr(Schema.String) })
		}).middleware(RequireAdmin)
	);
