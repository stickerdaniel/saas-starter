import { v } from 'convex/values';
import { calculateRateLimit, HOUR, MINUTE } from '@convex-dev/rate-limiter';
import { internalMutation } from '../_generated/server';
import { sendSupportRateLimitAlert } from '../emails/send';
import { ANONYMOUS_GLOBAL_RATE_LIMIT_KEY, supportRateLimiter } from './rateLimit';
import type { AnonymousRateLimitBucket } from './rateLimitAlertFields';

/**
 * Saturation alerts for the global anonymous support rate limits
 *
 * The anonymous buckets are shared by every signed-out visitor, so the first
 * sign that one is too small would otherwise be real users seeing "rate limit
 * reached". A cron samples each bucket and emails admins when it stays low.
 *
 * Sampled from a cron rather than checked at the limit call sites: `limit()`
 * returns only `{ ok, retryAfter }`, so a call-site check would add a read of
 * the bucket and of this alert state to every anonymous request, and write
 * the alert state from the request path. The cron costs three point reads per
 * run regardless of traffic and writes only when a bucket changes state. It
 * misses bursts shorter than the sampling interval, which "sustained" excludes
 * anyway.
 *
 * The cron sends in its own transaction and is the only writer of the alert
 * rows. The cooldown starts only when an email was enqueued, so an alert that
 * reached nobody (email off, no opted-in recipient, a failed enqueue) is
 * retried on the next low sample instead of going silent, without scheduling
 * anything in between.
 */

/** How often the cron samples the buckets (crons.ts). */
export const RATE_LIMIT_SAMPLE_INTERVAL_MINUTES = 10;

/** Share of a bucket's capacity in use at which a sample counts as low. */
const ALERT_THRESHOLD = 0.8;

/** At most one alert email per bucket in this window. */
const ALERT_COOLDOWN_HOURS = 6;

const MONITORED_BUCKETS: AnonymousRateLimitBucket[] = [
	'supportThreadCreateAnon',
	'supportFileUploadAnon',
	'supportFilePreviewAnon'
];

export const sampleAnonymousRateLimits = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const now = Date.now();
		// Sequential: three buckets, each with its own alert row.
		for (const bucket of MONITORED_BUCKETS) {
			const sample = await supportRateLimiter.getValue(ctx, bucket, {
				key: ANONYMOUS_GLOBAL_RATE_LIMIT_KEY
			});
			const { config } = sample;
			const capacity = config.capacity ?? config.rate;
			// getValue returns the value stored at the last limit() call; refill it to now.
			const available = calculateRateLimit(sample, config, now).value;
			const isLow = capacity - available >= capacity * ALERT_THRESHOLD;

			const row = await ctx.db
				.query('supportRateLimitAlerts')
				.withIndex('by_bucket', (q) => q.eq('bucket', bucket))
				.unique();
			if (!row && !isLow) continue;

			// An alert is due once two consecutive samples find the bucket low, so
			// a single burst that refills before the next sample stays quiet.
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
});
