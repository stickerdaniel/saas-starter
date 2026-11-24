import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { AdminRefusalCodec } from '../errorCodecs';
import RequireAdmin from '../middleware/RequireAdmin.spec';
import { ADMIN_ERROR_CODES } from './errors';
import { RoleSchema } from './schemas';

const Success = Schema.Struct({ success: Schema.Boolean });

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'banUser',
			args: () => ({ userId: Schema.String, reason: Schema.String }),
			returns: () => Success,
			error: () => AdminRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'revokeUserSessions',
			args: () => ({ userId: Schema.String }),
			returns: () => Success,
			error: () => AdminRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'seedFirstAdmin',
			args: () => ({ email: Schema.String }),
			returns: () =>
				Schema.Union([
					Schema.Struct({ success: Schema.Literal(true) }),
					Schema.Struct({
						success: Schema.Literal(false),
						code: Schema.Literal(ADMIN_ERROR_CODES.seedAdminExists)
					})
				]),
			error: () => AdminRefusalCodec
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'setUserRole',
			args: () => ({ userId: Schema.String, role: RoleSchema }),
			returns: () => Success,
			error: () => AdminRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'unbanUser',
			args: () => ({ userId: Schema.String }),
			returns: () => Success,
			error: () => AdminRefusalCodec
		}).middleware(RequireAdmin)
	);
