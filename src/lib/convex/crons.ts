import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
import { RATE_LIMIT_SAMPLE_INTERVAL_MINUTES } from './support/rateLimitAlerts';

const crons = cronJobs();

// See the docs at https://docs.convex.dev/agents/files
crons.interval('deleteUnusedFiles', { hours: 1 }, internal.files.vacuum.deleteUnusedFiles, {});

// Clean up expired uploads/download grants/files from files-control
crons.interval('cleanupExpiredFiles', { hours: 1 }, internal.files.cleanup.cleanupExpiredFiles, {});

// Clean up empty support threads (created via eager thread creation but never used)
// Runs every 6 hours to delete threads older than 24h with no messages
crons.interval('deleteEmptyThreads', { hours: 6 }, internal.support.threads.deleteEmptyThreads, {});

// Clean up stale pre-warmed AI chat threads (older than 7 days, never used)
crons.interval(
	'deleteStaleWarmThreads',
	{ hours: 24 },
	internal.aiChat.threads.deleteStaleWarmThreads,
	{}
);

// Email admins when a global anonymous support rate limit stays nearly used up.
// Reads three rate limit rows per run and writes only when a bucket changes state.
crons.interval(
	'sampleAnonymousSupportRateLimits',
	{ minutes: RATE_LIMIT_SAMPLE_INTERVAL_MINUTES },
	internal.support.rateLimitAlerts.sampleAnonymousRateLimits,
	{}
);

export default crons;
