// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, components } from '../convex/_generated/api';
import authSchema from '../convex-components/betterAuth/schema';
import schema from '../convex/schema';
import { convexModules, preloadModules } from './convexTest.modules';

const betterAuthModules = await preloadModules(
	import.meta.glob('../convex-components/betterAuth/**/*.ts')
);

describe('the convex-test module maps', () => {
	it('resolve an app function and a Better Auth component function', async () => {
		const t = convexTest(schema, convexModules);
		t.registerComponent('betterAuth', authSchema, betterAuthModules);
		const now = Date.now();
		const user = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					name: 'Ada',
					email: 'ada@example.com',
					emailVerified: true,
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string };
		const session = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'session',
				data: {
					userId: user._id,
					token: crypto.randomUUID(),
					expiresAt: now + 60_000,
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string };

		const viewer = await t
			.withIdentity({ subject: user._id, sessionId: session._id })
			.query(api.users.viewer, {});

		expect(viewer).toMatchObject({ _id: user._id, email: 'ada@example.com' });
	});
});
