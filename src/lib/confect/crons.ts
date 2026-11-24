import { CronJob, CronJobs } from '@confect/server';
import * as Duration from 'effect/Duration';
import refs from './_generated/refs';
import { RATE_LIMIT_SAMPLE_INTERVAL_MINUTES } from './support/rateLimitAlertFields';

export default CronJobs.make()
	// See the docs at https://docs.convex.dev/agents/files
	.add(
		CronJob.make(
			'deleteUnusedFiles',
			Duration.hours(1),
			refs.internal.files.vacuum.deleteUnusedFiles,
			{}
		)
	)
	// Clean up expired uploads/download grants/files from files-control
	.add(
		CronJob.make(
			'cleanupExpiredFiles',
			Duration.hours(1),
			refs.internal.files.cleanup.cleanupExpiredFiles,
			{}
		)
	)
	// Clean up empty support threads (created via eager thread creation but never used),
	// deleting threads older than 24h with no messages. Each run hands up to 100 threads
	// to their own checks (see threadMaintenance.ts); an idle run is one indexed read.
	.add(
		CronJob.make(
			'deleteEmptyThreads',
			Duration.minutes(15),
			refs.internal.support.threads.deleteEmptyThreads,
			{}
		)
	)
	// Clean up stale pre-warmed AI chat threads (older than 7 days, never used)
	.add(
		CronJob.make(
			'deleteStaleWarmThreads',
			Duration.hours(24),
			refs.internal.aiChat.threads.deleteStaleWarmThreads,
			{}
		)
	)
	// Email admins when a global anonymous support rate limit stays nearly used up.
	// Reads three rate limit rows per run and writes only when a bucket changes state.
	.add(
		CronJob.make(
			'sampleAnonymousSupportRateLimits',
			Duration.minutes(RATE_LIMIT_SAMPLE_INTERVAL_MINUTES),
			refs.internal.support.rateLimitAlerts.sampleAnonymousRateLimits,
			{}
		)
	);
