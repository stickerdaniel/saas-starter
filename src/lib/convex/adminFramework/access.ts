import { createAccessControl } from 'better-auth/plugins/access';
import type { BetterAuthUser } from '../admin/types';
import { adminMutation, adminQuery } from '../functions';

export const adminFrameworkStatements = {
	resource: ['read', 'create', 'update', 'delete', 'restore', 'force-delete', 'replicate'],
	action: ['run'],
	relationship: ['attach', 'detach'],
	metric: ['read']
} as const;

const accessControl = createAccessControl(adminFrameworkStatements);

const adminRole = accessControl.newRole({
	resource: ['read', 'create', 'update', 'delete', 'restore', 'force-delete', 'replicate'],
	action: ['run'],
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

export const permissionMutation = adminMutation;
