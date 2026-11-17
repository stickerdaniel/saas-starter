/**
 * Playwright Global Teardown
 *
 * Deletes exactly what the run's ownership ledger lists, from every attempt
 * file including those of workers that died: support threads of owned
 * anonymous IDs and owned accounts, test-only fixtures by token, accounts, and
 * recipient rows. It then reads the backend back and removes the ledger only
 * when nothing owned remains; on any failure the ledger stays for recovery and
 * the next run's global setup refuses to start.
 */

import { ConvexHttpClient } from 'convex/browser';
import { setTimeout as sleep } from 'node:timers/promises';
import { api } from '../src/lib/convex/_generated/api';
import 'varlock/auto-load';
import { resolveConvexUrl } from './utils/convex-url';
import {
	finishOwnedRun,
	ownedRunId,
	readOwnedRun,
	rememberedTeardownState,
	rememberTeardownState,
	type OwnedFixture
} from './utils/owned-test-data';

// Most thread IDs `cleanupAnonymousSupportThreads` accepts per call.
const SUPPORT_THREAD_BATCH = 25;
// The agent component deletes a thread's pages in scheduled steps, so its
// thread document can outlive the cleanup call by a few seconds.
const READ_BACK_TIMEOUT_MS = 30_000;
const READ_BACK_INTERVAL_MS = 1_000;

export default async function globalTeardown() {
	const runId = ownedRunId();
	if (!runId) return;
	const attempts = readOwnedRun(runId);
	const userEmails = [...new Set(attempts.flatMap((attempt) => attempt.userEmails))];
	const recipientEmails = [...new Set(attempts.flatMap((attempt) => attempt.recipientEmails))];
	const anonymousOwners = attempts.flatMap((attempt) => attempt.supportOwners);
	const fixtures: OwnedFixture[] = attempts.flatMap((attempt) => attempt.fixtures);
	const secret = process.env.AUTH_E2E_TEST_SECRET;
	const url = resolveConvexUrl();
	if (!secret || !url) throw new Error('Owned cleanup requires test secret and backend URL');
	const client = new ConvexHttpClient(url);
	const failures: unknown[] = [];
	const record = async (step: () => Promise<unknown>) => {
		try {
			await step();
		} catch (error) {
			failures.push(error);
		}
	};

	// Migration moves anonymous threads onto the signed-in account, so an owned
	// account's ID is a support owner too. Resolve the owners and their threads
	// while the accounts and app rows exist, and keep both in the run directory
	// before anything is deleted. A failed lookup ends teardown here.
	const remembered = rememberedTeardownState(runId);
	const accountOwners: string[] = [];
	for (const email of userEmails) {
		const { userId } = await client.mutation(api.tests.getAuthUserIdByEmail, { secret, email });
		if (userId) accountOwners.push(userId);
	}
	const supportOwners = [
		...new Set([...anonymousOwners, ...remembered.supportOwners, ...accountOwners])
	];
	const supportThreadIds = new Set(remembered.supportThreadIds);
	for (const userId of supportOwners)
		for (const thread of await client.mutation(api.tests.getSupportThreadsByUserId, {
			secret,
			userId
		}))
			supportThreadIds.add(thread.threadId);
	const threadIds = [...supportThreadIds];
	rememberTeardownState(runId, { supportOwners, supportThreadIds: threadIds });

	// The read-back below checks the agent threads, whose deletion this call only logs.
	for (let start = 0; start < threadIds.length; start += SUPPORT_THREAD_BATCH)
		await record(() =>
			client.mutation(api.tests.cleanupAnonymousSupportThreads, {
				secret,
				threadIds: threadIds.slice(start, start + SUPPORT_THREAD_BATCH)
			})
		);
	for (const fixture of fixtures)
		await record(() => client.mutation(api.tests.deleteOwnedFixture, { secret, fixture }));
	for (const email of userEmails)
		await record(() => client.mutation(api.tests.deleteTestUser, { email, secret }));
	await record(() =>
		client.mutation(api.tests.cleanupTestData, { secret, emails: recipientEmails })
	);

	await record(async () => {
		const deadline = Date.now() + READ_BACK_TIMEOUT_MS;
		for (;;) {
			const remaining = await client.query(api.tests.findOwnedTestData, {
				secret,
				userEmails,
				recipientEmails,
				supportOwners,
				supportThreadIds: threadIds,
				fixtures
			});
			if (Object.values(remaining).every((left) => left.length === 0)) return;
			if (Date.now() >= deadline)
				throw new Error(`Owned E2E data remains after cleanup: ${JSON.stringify(remaining)}`);
			await sleep(READ_BACK_INTERVAL_MS);
		}
	});

	// Playwright prints only the message of an error thrown here, so it names each failure.
	if (failures.length)
		throw new AggregateError(
			failures,
			`Owned E2E cleanup failed; ledger retained in e2e/.auth/owned/${runId}:\n` +
				failures
					.map((error) => `- ${error instanceof Error ? error.message : String(error)}`)
					.join('\n')
		);
	finishOwnedRun(runId);
	console.log(
		`[Teardown] Removed ${userEmails.length} accounts, ${recipientEmails.length} recipients, ` +
			`${threadIds.length} support threads of ${supportOwners.length} owners and ${fixtures.length} fixtures ` +
			`from ${attempts.length} worker attempts`
	);
}
