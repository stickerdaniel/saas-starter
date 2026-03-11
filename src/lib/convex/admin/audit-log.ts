import type { Doc } from '../_generated/dataModel';
import { ADMIN_ACTIONS, type AdminAction, type AuditMetadata, type BetterAuthUser } from './types';

export const CANONICAL_ADMIN_AUDIT_RESOURCE_NAME = 'users';

export type UnifiedAdminAuditLogRow = {
	_id: string;
	adminUserId: string;
	adminEmail?: string;
	action: AdminAction;
	targetUserId: string;
	targetEmail?: string;
	metadata?: AuditMetadata;
	timestamp: number;
	source: 'legacy' | 'canonical';
};

export function isAdminAction(value: string): value is AdminAction {
	return (ADMIN_ACTIONS as readonly string[]).includes(value);
}

export function buildCanonicalAdminActionAuditEntry(args: {
	adminUserId: string;
	adminEmail: string;
	targetUserId: string;
	action: AdminAction;
	metadata?: AuditMetadata;
	timestamp?: number;
}) {
	return {
		adminUserId: args.adminUserId,
		adminEmail: args.adminEmail,
		event: 'Action' as const,
		resourceName: CANONICAL_ADMIN_AUDIT_RESOURCE_NAME,
		resourceId: args.targetUserId,
		actionName: args.action,
		status: 'finished' as const,
		timestamp: args.timestamp ?? Date.now(),
		...(args.metadata ? { changes: args.metadata } : {})
	};
}

export function isCanonicalAdminActionLog(log: Doc<'adminResourceAuditLogs'>) {
	return (
		log.resourceName === CANONICAL_ADMIN_AUDIT_RESOURCE_NAME &&
		log.event === 'Action' &&
		typeof log.actionName === 'string' &&
		isAdminAction(log.actionName)
	);
}

export function createUserEmailMap(users: BetterAuthUser[]) {
	return new Map(users.map((user) => [user._id, user.email] as const));
}

export function normalizeLegacyAdminAuditLog(
	log: Doc<'adminAuditLogs'>,
	userEmails: ReadonlyMap<string, string>
): UnifiedAdminAuditLogRow {
	return {
		_id: String(log._id),
		adminUserId: log.adminUserId,
		adminEmail: userEmails.get(log.adminUserId),
		action: log.action,
		targetUserId: log.targetUserId,
		targetEmail: userEmails.get(log.targetUserId),
		metadata: log.metadata,
		timestamp: log.timestamp,
		source: 'legacy'
	};
}

export function normalizeCanonicalAdminAuditLog(
	log: Doc<'adminResourceAuditLogs'>,
	userEmails: ReadonlyMap<string, string>
): UnifiedAdminAuditLogRow {
	if (!log.actionName || !isAdminAction(log.actionName)) {
		throw new Error('Expected canonical admin action log');
	}

	return {
		_id: String(log._id),
		adminUserId: log.adminUserId,
		adminEmail: log.adminEmail || userEmails.get(log.adminUserId),
		action: log.actionName,
		targetUserId: log.resourceId,
		targetEmail: userEmails.get(log.resourceId),
		metadata: (log.changes as AuditMetadata | undefined) ?? {},
		timestamp: log.timestamp,
		source: 'canonical'
	};
}

export function mergeUnifiedAdminAuditLogs(args: {
	legacyLogs: Doc<'adminAuditLogs'>[];
	canonicalLogs: Doc<'adminResourceAuditLogs'>[];
	userEmails: ReadonlyMap<string, string>;
	adminUserId?: string;
	targetUserId?: string;
	limit: number;
}) {
	const merged: UnifiedAdminAuditLogRow[] = [
		...args.legacyLogs.map((log) => normalizeLegacyAdminAuditLog(log, args.userEmails)),
		...args.canonicalLogs
			.filter((log) => isCanonicalAdminActionLog(log))
			.map((log) => normalizeCanonicalAdminAuditLog(log, args.userEmails))
	];

	return merged
		.filter((log) => {
			if (args.adminUserId && log.adminUserId !== args.adminUserId) return false;
			if (args.targetUserId && log.targetUserId !== args.targetUserId) return false;
			return true;
		})
		.sort((a, b) => b.timestamp - a.timestamp)
		.slice(0, args.limit);
}
