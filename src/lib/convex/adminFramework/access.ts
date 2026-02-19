import { createAccessControl } from 'better-auth/plugins/access';
import type { BetterAuthUser } from '../admin/types';
import { adminQuery, getActiveSession } from '../functions';
import { customCtx, customMutation } from 'convex-helpers/server/customFunctions';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { adminFrameworkAggregateTriggers } from './utils/aggregates';

export const adminFrameworkStatements = {
	resource: ['read', 'create', 'update', 'delete', 'restore', 'force-delete', 'replicate'],
	action: ['run', 'run-destructive'],
	relationship: ['attach', 'detach'],
	metric: ['read']
} as const;

const accessControl = createAccessControl(adminFrameworkStatements);

const adminRole = accessControl.newRole({
	resource: ['read', 'create', 'update', 'delete', 'restore', 'force-delete', 'replicate'],
	action: ['run', 'run-destructive'],
	relationship: ['attach', 'detach'],
	metric: ['read']
});

const userRole = accessControl.newRole({
	resource: ['read'],
	action: [],
	relationship: [],
	metric: ['read']
});

type StatementRequest = {
	resource?: Array<(typeof adminFrameworkStatements)['resource'][number]>;
	action?: Array<(typeof adminFrameworkStatements)['action'][number]>;
	relationship?: Array<(typeof adminFrameworkStatements)['relationship'][number]>;
	metric?: Array<(typeof adminFrameworkStatements)['metric'][number]>;
};

export function assertPermission(user: BetterAuthUser, request: StatementRequest) {
	const role = user.role === 'admin' ? adminRole : userRole;
	const result = role.authorize(request);
	if (!result.success) {
		throw new Error(result.error || 'Unauthorized');
	}
}

export const permissionQuery = adminQuery;

export const permissionMutation = customMutation(
	mutation,
	customCtx(async (ctx) => {
		const user = (await authComponent.getAuthUser(ctx)) as BetterAuthUser | null;
		if (!user || user.role !== 'admin') {
			throw new Error('Unauthorized: Admin access required');
		}
		const wrappedCtx = adminFrameworkAggregateTriggers.wrapDB(ctx);
		const session = await getActiveSession(ctx);
		return {
			user,
			db: wrappedCtx.db,
			organizationId: session?.activeOrganizationId ?? null
		};
	})
);
