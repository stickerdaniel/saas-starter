import type { GenericDatabaseWriter } from 'convex/server';
import type { DataModel } from '../../_generated/dataModel';

type ActionHandler = (
	db: GenericDatabaseWriter<DataModel>,
	actionName: string,
	recordId: string
) => Promise<void>;

async function dispatchTaskAction(
	db: GenericDatabaseWriter<DataModel>,
	actionName: string,
	recordId: string
) {
	const task = await db.get(recordId as any);
	if (!task) throw new Error(`Record not found: ${recordId}`);
	if (
		actionName === 'queuedBulkProcess' ||
		actionName === 'markDone' ||
		actionName === 'quickDone'
	) {
		await db.patch(recordId as any, { status: 'done', updatedAt: Date.now() });
	} else if (actionName === 'markInProgress') {
		await db.patch(recordId as any, { status: 'in_progress', updatedAt: Date.now() });
	} else {
		throw new Error(`Unknown task action: ${actionName}`);
	}
}

/**
 * Maps resource names to their queued action handlers.
 * Add entries here when a new resource supports queued actions.
 */
const dispatchers: Record<string, ActionHandler> = {
	'demo-tasks': dispatchTaskAction
};

export function getActionDispatcher(resourceName: string): ActionHandler | undefined {
	return dispatchers[resourceName];
}
