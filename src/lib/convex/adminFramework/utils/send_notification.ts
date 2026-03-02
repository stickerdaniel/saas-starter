import type { GenericDatabaseWriter } from 'convex/server';
import type { DataModel } from '../../_generated/dataModel';

type NotificationType = 'success' | 'error' | 'warning' | 'info';
type NotificationSource = 'audit' | 'action' | 'system' | 'admin';

interface SendAdminNotificationArgs {
	db: GenericDatabaseWriter<DataModel>;
	userId: string;
	type: NotificationType;
	icon: string;
	message: string;
	messageParams?: Record<string, unknown>;
	actionText?: string;
	actionUrl?: string;
	openInNewTab?: boolean;
	source?: NotificationSource;
	sourceResourceName?: string;
	sourceResourceId?: string;
}

/**
 * Internal helper to insert an admin notification.
 * Call from any mutation context that has a db writer.
 *
 * @example
 * ```ts
 * await sendAdminNotification({
 *   db: ctx.db,
 *   userId: targetUser._id,
 *   type: 'info',
 *   icon: 'bell',
 *   message: 'A new project was created',
 *   source: 'audit',
 *   sourceResourceName: 'demo-projects',
 *   sourceResourceId: projectId
 * });
 * ```
 */
export async function sendAdminNotification(args: SendAdminNotificationArgs) {
	await args.db.insert('adminNotifications', {
		type: args.type,
		icon: args.icon,
		message: args.message,
		messageParams: args.messageParams,
		actionText: args.actionText,
		actionUrl: args.actionUrl,
		openInNewTab: args.openInNewTab,
		userId: args.userId,
		readAt: undefined,
		source: args.source,
		sourceResourceName: args.sourceResourceName,
		sourceResourceId: args.sourceResourceId,
		createdAt: Date.now()
	});
}
