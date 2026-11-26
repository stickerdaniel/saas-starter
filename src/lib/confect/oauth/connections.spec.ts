import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import RequireUser from '../middleware/RequireUser.spec';
import { PaginationOpts } from '../schemas/pagination';

const Connection = Schema.Struct({
	consentId: Schema.String,
	clientId: Schema.String,
	clientName: Schema.NullOr(Schema.String),
	scopes: Schema.Array(Schema.String),
	connectedAt: Schema.NullOr(Schema.Number),
	lastUsedAt: Schema.NullOr(Schema.Number)
});

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'epoch',
			args: () => ({ userId: Schema.String }),
			returns: () => Schema.Number
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'list',
			args: () => ({ paginationOpts: PaginationOpts }),
			returns: () =>
				Schema.Struct({
					page: Schema.mutable(Schema.Array(Connection)),
					isDone: Schema.Boolean,
					continueCursor: Schema.String
				})
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'endpoint',
			returns: () => Schema.Struct({ url: Schema.String })
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'recordUse',
			args: () => ({
				userId: Schema.String,
				clientId: Schema.String,
				grant: Schema.String,
				at: Schema.Number
			}),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'revoke',
			args: () => ({ consentId: Schema.String }),
			returns: () => Schema.Struct({ revoked: Schema.Boolean })
		}).middleware(RequireUser)
	);
