import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// See the docs at https://docs.convex.dev/agents/files
crons.interval('deleteUnusedFiles', { hours: 1 }, internal.files.vacuum.deleteUnusedFiles, {});

// Clean up expired uploads/download grants/files from files-control
crons.interval('cleanupExpiredFiles', { hours: 1 }, internal.files.cleanup.cleanupExpiredFiles, {});

// Clean up empty support threads (created via eager thread creation but never used)
// Runs every 6 hours to delete threads older than 24h with no messages
crons.interval('deleteEmptyThreads', { hours: 6 }, internal.support.threads.deleteEmptyThreads, {});

// Prune old admin audit logs (90-day retention, batch-deletes with self-scheduling continuation)
crons.interval(
	'pruneAdminAuditLogs',
	{ hours: 24 },
	internal.adminFramework.pruning.pruneAdminAuditLogs,
	{}
);

// Prune old resource audit logs (90-day retention)
crons.interval(
	'pruneResourceAuditLogs',
	{ hours: 24 },
	internal.adminFramework.pruning.pruneResourceAuditLogs,
	{}
);

// Prune old admin notifications (90-day retention)
crons.interval(
	'pruneAdminNotifications',
	{ hours: 24 },
	internal.adminFramework.pruning.pruneAdminNotifications,
	{}
);

export default crons;
