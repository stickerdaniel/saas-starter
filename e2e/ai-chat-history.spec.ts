import { test, expect } from '@playwright/test';
import 'varlock/auto-load';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import type { Id } from '../src/lib/convex/_generated/dataModel';
import { readTestCredentials } from './utils/auth';
import { resolveConvexUrl } from './utils/convex-url';
import { resolveSiteUrl } from './utils/site-url';
import { ownTestEmail } from './utils/owned-test-data';

// Cheaper layers rejected because: the real index must exclude undefined keys, include zero,
// and order the authenticated user's complete history before applying the limit.
// Request-only verification exercises the deployed query without opening a history UI.
test('lists old-created active conversations before limiting visible history', async ({
	request
}) => {
	const client = new ConvexHttpClient(resolveConvexUrl()!);
	const secret = process.env.AUTH_E2E_TEST_SECRET!;
	const { admin } = readTestCredentials();
	const user = { email: `history-${crypto.randomUUID()}@e2e.example.com` };
	ownTestEmail(user.email, 'userEmails');
	const signup = await request.post('/api/auth/sign-up/email', {
		headers: { Origin: resolveSiteUrl() },
		data: { email: user.email, password: 'TestPassword123!', name: 'History fixture' }
	});
	expect(signup.ok()).toBe(true);
	await client.mutation(api.tests.verifyTestUserEmail, { secret, email: user.email });
	const signin = await request.post('/api/auth/sign-in/email', {
		headers: { Origin: resolveSiteUrl() },
		data: { email: user.email, password: 'TestPassword123!' }
	});
	expect(signin.ok()).toBe(true);
	const tokenResponse = await request.get('/api/auth/convex/token');
	expect(tokenResponse.ok()).toBe(true);
	const { token } = await tokenResponse.json();
	client.setAuth(token);
	const own = await client.mutation(api.tests.getAuthUserIdByEmail, { secret, email: user.email });
	const other = await client.mutation(api.tests.getAuthUserIdByEmail, {
		secret,
		email: admin.email
	});
	const prefix = `history-${crypto.randomUUID()}`;
	const ids: Array<Id<'aiChatThreads'>> = [];
	type Row = {
		threadId: string;
		createdAt: number;
		lastMessageAt?: number;
		lastMessage?: string;
		isWarm?: boolean;
	};
	const rows: Row[] = [
		{ threadId: `${prefix}-old-active`, createdAt: 1, lastMessageAt: 10_000 },
		...Array.from({ length: 45 }, (_, i) => ({
			threadId: `${prefix}-visible-${i}`,
			createdAt: 100 + i,
			lastMessageAt: 100 + i
		})),
		...Array.from({ length: 25 }, (_, i) => ({
			threadId: `${prefix}-hidden-${i}`,
			createdAt: 1000 + i,
			...(i % 2 === 0 ? { isWarm: true, lastMessageAt: 20_000 + i } : {})
		})),
		{ threadId: `${prefix}-legacy`, createdAt: 200, lastMessage: 'Legacy preview' },
		{ threadId: `${prefix}-zero`, createdAt: 201, lastMessageAt: 0 },
		{ threadId: `${prefix}-file-only`, createdAt: 202, lastMessageAt: 9000 }
	];
	const visible = rows
		.filter((row) => !row.isWarm && (row.lastMessageAt !== undefined || !!row.lastMessage))
		.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
	try {
		ids.push(
			...(await client.mutation(api.tests.seedAiChatHistoryRows, {
				secret,
				userId: own.userId!,
				rows
			}))
		);
		ids.push(
			...(await client.mutation(api.tests.seedAiChatHistoryRows, {
				secret,
				userId: other.userId!,
				rows: [{ threadId: `${prefix}-foreign`, createdAt: 1, lastMessageAt: 30_000 }]
			}))
		);
		for (const limit of [20, visible.length, visible.length + 1]) {
			const result = await client.query(api.aiChat.threads.listThreads, { limit });
			expect(result.threads.slice(0, Math.min(limit, 47)).map((row) => row._id)).toEqual(
				visible.slice(0, Math.min(limit, 47)).map((row) => row.threadId)
			);
			expect(result.hasMore).toBe(limit < visible.length);
			expect(
				result.threads.some((row) => row._id.endsWith('-foreign') || row._id.includes('-hidden-'))
			).toBe(false);
			if (limit >= visible.length) {
				expect(
					result.threads
						.slice(-2)
						.map((row) => row._id)
						.sort()
				).toEqual([`${prefix}-legacy`, `${prefix}-zero`].sort());
				expect(result.threads.find((row) => row._id.endsWith('-legacy'))?.lastMessageAt).toBe(200);
				expect(result.threads.find((row) => row._id.endsWith('-zero'))?.lastMessageAt).toBe(0);
				expect((await client.query(api.aiChat.threads.listThreads, { limit })).threads).toEqual(
					result.threads
				);
			}
		}
	} finally {
		await client.mutation(api.tests.deleteAiChatHistoryRows, { secret, ids });
		await client.mutation(api.tests.deleteTestUser, { secret, email: user.email });
	}
});
