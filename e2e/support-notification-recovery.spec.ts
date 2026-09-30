import { test, expect } from '@playwright/test';
import 'varlock/auto-load';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import { resolveConvexUrl } from './utils/convex-url';

// Cheaper layers rejected because: recovery and stale cleanup must commit through real nested Convex transactions.
// Request-only verification uses a secret-gated isolated fixture and never enqueues email.
test('recovers an interrupted support claim and fences duplicate recovery', async () => {
	const client = new ConvexHttpClient(resolveConvexUrl()!);
	const secret = process.env.AUTH_E2E_TEST_SECRET!;
	const fixture = await client.mutation(api.tests.seedSupportNotificationClaim, { secret });
	try {
		expect(fixture.deadline).toBeGreaterThan(Date.now());
		const { deadline: _deadline, ...ownership } = fixture;
		const result = await client.mutation(api.tests.recoverSupportNotificationFixture, {
			secret,
			...ownership
		});
		expect(result).toEqual({
			recovered: true,
			duplicateRecovered: false,
			staleDeleted: false,
			retryCount: 1,
			sameGeneration: true,
			scheduled: true,
			claimCleared: true
		});
	} finally {
		await client.mutation(api.tests.deleteSupportNotificationFixture, {
			secret,
			notificationId: fixture.notificationId
		});
	}
});
