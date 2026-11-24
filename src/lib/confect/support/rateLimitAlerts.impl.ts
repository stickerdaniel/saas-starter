import { FunctionImpl, GroupImpl } from '@confect/server';
import { calculateRateLimit, HOUR, MINUTE } from '@convex-dev/rate-limiter';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import databaseSchema from '../_generated/schema';
import { MutationCtx } from '../_generated/services';
import { sendSupportRateLimitAlert } from '../emails/send';
import { ANONYMOUS_GLOBAL_RATE_LIMIT_KEY, supportRateLimiter } from './rateLimit';
import type { AnonymousRateLimitBucket } from './rateLimitAlertFields';
import rateLimitAlerts from './rateLimitAlerts.spec';

const ALERT_THRESHOLD = 0.8;

const ALERT_COOLDOWN_HOURS = 6;

const MONITORED_BUCKETS: AnonymousRateLimitBucket[] = [
	'supportThreadCreateAnon',
	'supportFileUploadAnon',
	'supportFilePreviewAnon'
];

async function sampleBuckets(ctx: ConvexMutationCtx) {
	const now = Date.now();
	for (const bucket of MONITORED_BUCKETS) {
		const sample = await supportRateLimiter.getValue(ctx, bucket, {
			key: ANONYMOUS_GLOBAL_RATE_LIMIT_KEY
		});
		const { config } = sample;
		const capacity = config.capacity ?? config.rate;
		const available = calculateRateLimit(sample, config, now).value;
		const isLow = capacity - available >= capacity * ALERT_THRESHOLD;

		const row = await ctx.db
			.query('supportRateLimitAlerts')
			.withIndex('by_bucket', (q) => q.eq('bucket', bucket))
			.unique();
		if (!row && !isLow) continue;

		const lowSince = isLow ? (row?.lowSince ?? now) : undefined;
		const dueSince = isLow ? row?.lowSince : undefined;
		const coolingDown =
			row?.alertedAt !== undefined && now - row.alertedAt < ALERT_COOLDOWN_HOURS * HOUR;

		let alertedAt = row?.alertedAt;
		if (dueSince !== undefined && !coolingDown) {
			const sent = await sendSupportRateLimitAlert(ctx, {
				bucket,
				available: Math.max(0, Math.floor(available)),
				capacity,
				ratePerHour: Math.round((config.rate / config.period) * HOUR),
				lowForMinutes: Math.round((now - dueSince) / MINUTE),
				cooldownHours: ALERT_COOLDOWN_HOURS
			});
			if (sent > 0) alertedAt = now;
		}

		if (row) {
			if (lowSince !== row.lowSince || alertedAt !== row.alertedAt) {
				await ctx.db.patch('supportRateLimitAlerts', row._id, { lowSince, alertedAt });
			}
		} else {
			await ctx.db.insert('supportRateLimitAlerts', { bucket, lowSince, alertedAt });
		}
	}
	return null;
}

export default GroupImpl.make(databaseSchema, rateLimitAlerts).pipe(
	Layer.provide(
		FunctionImpl.make(databaseSchema, rateLimitAlerts, 'sampleAnonymousRateLimits', () =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => sampleBuckets(ctx));
			})
		)
	),
	GroupImpl.finalize
);
