// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, components } from '../../../_generated/api';
import authSchema from '../../../betterAuth/schema';
import { convexModules, preloadModules } from '../../../convexTest.modules';
import schema from '../../../schema';

const betterAuthModules = await preloadModules(import.meta.glob('../../../betterAuth/**/*.ts'));
const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function createUser(t: Harness, data: { name: string; email: string; role: string }) {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: { model: 'user', data: { emailVerified: true, createdAt: now, updatedAt: now, ...data } }
	})) as { _id: string };
	return user._id;
}

async function signIn(t: Harness, userId: string) {
	const now = Date.now();
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId,
				token: crypto.randomUUID(),
				expiresAt: now + 60_000,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	return t.withIdentity({ subject: userId, sessionId: session._id });
}

describe('listInternalUserNotes', () => {
	it('keeps the author of a note written by a since demoted admin', async () => {
		const t = harness();
		const viewer = await createUser(t, { name: 'Sam', email: 'sam@example.com', role: 'admin' });
		const author = await createUser(t, { name: 'Ada', email: 'ada@example.com', role: 'user' });
		await t.run((ctx) =>
			ctx.db.insert('internalUserNotes', {
				userId: 'customer_1',
				adminUserId: author,
				content: 'Refunded March',
				createdAt: Date.now()
			})
		);

		const asViewer = await signIn(t, viewer);
		const notes = await asViewer.query(api.admin.support.queries.listInternalUserNotes, {
			userId: 'customer_1'
		});

		expect(notes.page).toMatchObject([
			{ adminUserId: author, adminName: 'Ada', adminEmail: 'ada@example.com' }
		]);
	});
});
