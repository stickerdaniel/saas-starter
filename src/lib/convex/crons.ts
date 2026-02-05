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

export default crons;
