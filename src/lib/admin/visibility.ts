import type { BetterAuthUser } from '$lib/convex/admin/types';
import type { FieldDefinition, ResourceDefinition } from './types';

type MaybeUser = BetterAuthUser | null | undefined;
type MaybeRecord = Record<string, unknown> | null | undefined;
export type ViewerUser = BetterAuthUser | undefined;

function hasRoleAdmin(user: MaybeUser): user is BetterAuthUser {
	return Boolean(user && user.role === 'admin');
}

function evaluateResourceGuard(
	guard:
		| ((user: BetterAuthUser) => boolean)
		| ((user: BetterAuthUser, record: Record<string, unknown>) => boolean)
		| undefined,
	args: {
		user?: MaybeUser;
		record?: MaybeRecord;
	}
) {
	if (!guard) return true;
	if (!hasRoleAdmin(args.user)) return false;
	if (args.record && typeof args.record === 'object') {
		return (guard as (user: BetterAuthUser, record: Record<string, unknown>) => boolean)(
			args.user,
			args.record
		);
	}
	return (guard as (user: BetterAuthUser) => boolean)(args.user);
}

export function getViewerUser(viewer: unknown): BetterAuthUser | undefined {
	if (!viewer || typeof viewer !== 'object') return undefined;
	const maybeUser = viewer as Partial<BetterAuthUser>;
	if (typeof maybeUser._id !== 'string' || typeof maybeUser.email !== 'string') return undefined;
	return maybeUser as BetterAuthUser;
}

export function isResourceVisible(resource: ResourceDefinition<any>, user: MaybeUser) {
	if (typeof resource.canSee !== 'function') return true;
	if (!hasRoleAdmin(user)) return false;
	return resource.canSee(user);
}

export function isResourceCreatable(resource: ResourceDefinition<any>, user: MaybeUser) {
	return evaluateResourceGuard(resource.canCreate, { user });
}

export function isResourceUpdatable(
	resource: ResourceDefinition<any>,
	user: MaybeUser,
	record?: MaybeRecord
) {
	return evaluateResourceGuard(resource.canUpdate, { user, record });
}

export function isResourceDeletable(
	resource: ResourceDefinition<any>,
	user: MaybeUser,
	record?: MaybeRecord
) {
	return evaluateResourceGuard(resource.canDelete, { user, record });
}

export function isFieldVisible(
	field: FieldDefinition<any>,
	args: {
		user?: MaybeUser;
		record?: MaybeRecord;
	}
) {
	const { user, record } = args;
	const visibleFields = record?._visibleFields;
	if (Array.isArray(visibleFields) && !visibleFields.includes(field.attribute)) {
		return false;
	}
	if (typeof field.canSee === 'function') {
		if (!hasRoleAdmin(user)) return false;
		return field.canSee(user, record);
	}
	return true;
}

export function isFieldDependencySatisfied(
	field: FieldDefinition<any>,
	values: Record<string, unknown>
) {
	const dependency = field.dependsOn;
	if (!dependency) return true;
	const sourceValue = values[dependency.field];
	if (typeof dependency.predicate === 'function') {
		return dependency.predicate(sourceValue);
	}
	if (dependency.value !== undefined) {
		return sourceValue === dependency.value;
	}
	return Boolean(sourceValue);
}

function evaluateGuard(
	guard: FieldDefinition<any>['readonly'] | FieldDefinition<any>['immutable'],
	args: {
		user?: MaybeUser;
		record?: MaybeRecord;
	}
) {
	if (typeof guard === 'function') {
		if (!hasRoleAdmin(args.user)) return false;
		return guard({ user: args.user, record: args.record });
	}
	return Boolean(guard);
}

export function isFieldDisabled(
	field: FieldDefinition<any>,
	args: {
		user?: MaybeUser;
		record?: MaybeRecord;
		isEdit: boolean;
	}
) {
	if (evaluateGuard(field.readonly, args)) return true;
	if (args.isEdit && evaluateGuard(field.immutable, args)) return true;
	return false;
}
