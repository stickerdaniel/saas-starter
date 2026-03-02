import type { BetterAuthUser } from '../../admin/types';

export type CrudOperation = 'create' | 'update' | 'delete';

export type RelationOperation = 'add' | 'attach' | 'detach';

type CrudGuard = {
	canCreate?: (user: BetterAuthUser) => boolean;
	canUpdate?: (user: BetterAuthUser, record: Record<string, unknown> | null) => boolean;
	canDelete?: (user: BetterAuthUser, record: Record<string, unknown> | null) => boolean;
};

type RelationGuard = {
	canAdd?: (user: BetterAuthUser, parentRecord: Record<string, unknown>) => boolean;
	canAttach?: (user: BetterAuthUser, parentRecord: Record<string, unknown>) => boolean;
	canDetach?: (user: BetterAuthUser, parentRecord: Record<string, unknown>) => boolean;
};

const resourceCrudGuards: Record<string, CrudGuard> = {
	'demo-projects': {},
	'demo-tasks': {},
	'demo-comments': {},
	'demo-tags': {}
};

/**
 * Per-resource, per-relation guards. Keyed by `resourceName.relationField`.
 * For example, `demo-projects.tagIds` guards attach/detach on the tags relation.
 */
const relationGuards: Record<string, RelationGuard> = {
	'demo-projects.tagIds': {
		canDetach: (_user, parent) => parent.status !== 'archived'
	}
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

/**
 * Assert that a relation operation (add/attach/detach) is allowed.
 *
 * @param args.resourceName - The parent resource name (e.g. 'demo-projects')
 * @param args.relationField - The relation field attribute (e.g. 'tagIds')
 * @param args.operation - 'add' | 'attach' | 'detach'
 * @param args.user - The current user
 * @param args.parentRecord - The parent record the relation belongs to
 */
export function assertRelationAllowed(args: {
	resourceName: string;
	relationField: string;
	operation: RelationOperation;
	user: BetterAuthUser | null | undefined;
	parentRecord: Record<string, unknown>;
}) {
	const { resourceName, relationField, operation, user, parentRecord } = args;
	if (!isAdmin(user)) {
		throw new Error('Not authorized');
	}

	const key = `${resourceName}.${relationField}`;
	const guard = relationGuards[key];
	if (!guard) return;

	if (operation === 'add' && guard.canAdd && !guard.canAdd(user, parentRecord)) {
		throw new Error('Not authorized: cannot add related record');
	}
	if (operation === 'attach' && guard.canAttach && !guard.canAttach(user, parentRecord)) {
		throw new Error('Not authorized: cannot attach related record');
	}
	if (operation === 'detach' && guard.canDetach && !guard.canDetach(user, parentRecord)) {
		throw new Error('Not authorized: cannot detach related record');
	}
}
