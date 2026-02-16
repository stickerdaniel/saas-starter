import type { BetterAuthUser } from '../../admin/types';

export type CrudOperation = 'create' | 'update' | 'delete';

type CrudGuard = {
	canCreate?: (user: BetterAuthUser) => boolean;
	canUpdate?: (user: BetterAuthUser, record: Record<string, unknown> | null) => boolean;
	canDelete?: (user: BetterAuthUser, record: Record<string, unknown> | null) => boolean;
};

const resourceCrudGuards: Record<string, CrudGuard> = {
	'demo-projects': {},
	'demo-tasks': {},
	'demo-comments': {},
	'demo-tags': {}
};

function isAdmin(user: BetterAuthUser | null | undefined): user is BetterAuthUser {
	return Boolean(user && user.role === 'admin');
}

export function assertResourceCrudAllowed(args: {
	resourceName: string;
	operation: CrudOperation;
	user: BetterAuthUser | null | undefined;
	record?: Record<string, unknown> | null;
}) {
	const { resourceName, operation, user, record = null } = args;
	if (!isAdmin(user)) {
		throw new Error('Not authorized');
	}

	const guard = resourceCrudGuards[resourceName];
	if (!guard) {
		console.warn(
			`[admin:guard] Unknown resource "${resourceName}" — no resource-specific guard configured`
		);
		return;
	}

	if (operation === 'create' && guard.canCreate && !guard.canCreate(user)) {
		throw new Error('Not authorized');
	}
	if (operation === 'update' && guard.canUpdate && !guard.canUpdate(user, record)) {
		throw new Error('Not authorized');
	}
	if (operation === 'delete' && guard.canDelete && !guard.canDelete(user, record)) {
		throw new Error('Not authorized');
	}
}
