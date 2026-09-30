import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import 'varlock/auto-load';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConvexUrl } from './utils/convex-url';
import { readOwnedTestData, finishOwnedTestData } from './utils/owned-test-data';

export default async function globalTeardown() {
	const owned = readOwnedTestData();
	if (!owned) return;
	const secret = process.env.AUTH_E2E_TEST_SECRET;
	const url = resolveConvexUrl();
	if (!secret || !url) throw new Error('Owned cleanup requires test secret and backend URL');
	const client = new ConvexHttpClient(url);
	const failures: unknown[] = [];
	for (const email of owned.userEmails) {
		try {
			await client.mutation(api.tests.deleteTestUser, { email, secret });
		} catch (error) {
			failures.push(error);
		}
	}
	try {
		await client.mutation(api.tests.cleanupTestData, { secret, emails: owned.recipientEmails });
	} catch (error) {
		failures.push(error);
	}
	if (failures.length)
		throw new AggregateError(failures, 'Owned E2E cleanup failed; ownership record retained');
	finishOwnedTestData();
	const credentials = join(process.cwd(), 'e2e', '.auth', 'test-credentials.json');
	if (existsSync(credentials)) unlinkSync(credentials);
}
