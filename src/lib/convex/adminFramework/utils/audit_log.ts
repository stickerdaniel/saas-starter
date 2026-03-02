import type { GenericDatabaseWriter, TableNamesInDataModel } from 'convex/server';
import type { DataModel } from '../../_generated/dataModel';
import type { BetterAuthUser } from '../../admin/types';
import type { Triggers, Change } from 'convex-helpers/server/triggers';
import type { AdminTriggerCtx } from './aggregates';
import { RESOURCE_SEARCH_INDEXES } from './search_index';

type AuditEvent =
	| 'Create'
	| 'Update'
	| 'Delete'
	| 'Restore'
	| 'ForceDelete'
	| 'Replicate'
	| 'Action'
	| 'Attach'
	| 'Detach';

interface LogResourceAuditEventArgs {
	db: GenericDatabaseWriter<DataModel>;
	user: BetterAuthUser;
	event: AuditEvent;
	resourceName: string;
	resourceId: string;
	actionName?: string;
	original?: Record<string, unknown>;
	changes?: Record<string, unknown>;
	batchId?: string;
	status?: 'finished' | 'failed';
	exception?: string;
}

// --- Audit hint types for trigger-based logging ---

export type AuditHint =
	| { event: 'Replicate'; original: Record<string, unknown> }
	| { event: 'Action'; actionName: string; batchId?: string }
	| { suppress: true };

export interface AuditState {
	hint: AuditHint | null;
}

export function createAuditState(): AuditState {
	return { hint: null };
}

// --- Derived from RESOURCE_SEARCH_INDEXES (single source of truth) ---

const TABLE_TO_RESOURCE = new Map<string, string>();
const SOFT_DELETE_TABLES = new Set<string>();

for (const config of Object.values(RESOURCE_SEARCH_INDEXES)) {
	TABLE_TO_RESOURCE.set(config.table, config.resourceName);
	if (config.softDeletes) {
		SOFT_DELETE_TABLES.add(config.table);
	}
}

// --- Trigger-based audit event inference ---

const SYSTEM_FIELDS = new Set(['_id', '_creationTime', 'updatedAt']);

export function computeChanges(
	original: Record<string, unknown>,
	updated: Record<string, unknown>
): Record<string, unknown> | undefined {
	const diff: Record<string, unknown> = {};
	for (const key of Object.keys(updated)) {
		if (SYSTEM_FIELDS.has(key)) continue;
		const oldVal = original[key];
		const newVal = updated[key];
		if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
			diff[key] = newVal;
		}
	}
	return Object.keys(diff).length > 0 ? diff : undefined;
}

export async function logResourceAuditEvent(args: LogResourceAuditEventArgs) {
	await args.db.insert('adminResourceAuditLogs', {
		adminUserId: args.user._id,
		adminEmail: args.user.email,
		event: args.event,
		resourceName: args.resourceName,
		resourceId: args.resourceId,
		actionName: args.actionName,
		original: args.original,
		changes: args.changes,
		batchId: args.batchId,
		status: args.status ?? 'finished',
		exception: args.exception,
		timestamp: Date.now()
	});
}

// --- Register audit triggers on all resource tables ---

type AuditableTable = TableNamesInDataModel<DataModel>;

function inferAuditEvent(
	change: Change<DataModel, AuditableTable>,
	hint: AuditHint | null,
	tableName: string
): {
	event: AuditEvent;
	original?: Record<string, unknown>;
	changes?: Record<string, unknown>;
	actionName?: string;
	batchId?: string;
} | null {
	// Suppress hint — skip audit entirely
	if (hint && 'suppress' in hint) return null;

	if (change.operation === 'insert') {
		if (hint && 'event' in hint && hint.event === 'Replicate') {
			return {
				event: 'Replicate',
				original: hint.original,
				changes: change.newDoc as Record<string, unknown>
			};
		}
		return {
			event: 'Create',
			changes: change.newDoc as Record<string, unknown>
		};
	}

	if (change.operation === 'update') {
		// Action hint takes priority
		if (hint && 'event' in hint && hint.event === 'Action') {
			const changes = computeChanges(
				change.oldDoc as Record<string, unknown>,
				change.newDoc as Record<string, unknown>
			);
			return {
				event: 'Action',
				actionName: hint.actionName,
				batchId: hint.batchId,
				original: change.oldDoc as Record<string, unknown>,
				changes
			};
		}

		// Soft-delete detection for tables that support it
		if (SOFT_DELETE_TABLES.has(tableName)) {
			const oldDeletedAt = (change.oldDoc as Record<string, unknown>).deletedAt;
			const newDeletedAt = (change.newDoc as Record<string, unknown>).deletedAt;

			// deletedAt was set (soft delete)
			if (oldDeletedAt === undefined && newDeletedAt !== undefined) {
				return {
					event: 'Delete',
					original: change.oldDoc as Record<string, unknown>,
					changes: { deletedAt: newDeletedAt }
				};
			}

			// deletedAt was cleared (restore)
			if (oldDeletedAt !== undefined && newDeletedAt === undefined) {
				return {
					event: 'Restore',
					original: change.oldDoc as Record<string, unknown>,
					changes: { deletedAt: undefined }
				};
			}
		}

		// Regular update
		const changes = computeChanges(
			change.oldDoc as Record<string, unknown>,
			change.newDoc as Record<string, unknown>
		);
		if (!changes) return null; // No meaningful changes
		return {
			event: 'Update',
			original: change.oldDoc as Record<string, unknown>,
			changes
		};
	}

	if (change.operation === 'delete') {
		return {
			event: 'ForceDelete',
			original: change.oldDoc as Record<string, unknown>
		};
	}

	return null;
}

export function registerAuditTriggers(triggers: Triggers<DataModel, AdminTriggerCtx>) {
	for (const [tableName, resourceName] of TABLE_TO_RESOURCE) {
		const table = tableName as TableNamesInDataModel<DataModel>;
		triggers.register(table, async (ctx, change) => {
			const user = (ctx as AdminTriggerCtx).user;
			const auditState = (ctx as AdminTriggerCtx)._auditState;

			// Skip if no user context (e.g. system-level operations)
			if (!user) return;

			const hint = auditState?.hint ?? null;
			// Clear hint after reading — one hint per db operation
			if (auditState) auditState.hint = null;

			const result = inferAuditEvent(change, hint, tableName);
			if (!result) return;

			// Use innerDb to bypass trigger interception
			await ctx.innerDb.insert('adminResourceAuditLogs', {
				adminUserId: user._id,
				adminEmail: user.email,
				event: result.event,
				resourceName,
				resourceId: String(change.id),
				actionName: result.actionName,
				original: result.original,
				changes: result.changes,
				batchId: result.batchId,
				status: 'finished',
				timestamp: Date.now()
			});
		});
	}
}
