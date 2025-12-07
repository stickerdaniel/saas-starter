import { components } from './_generated/api';
import { internalAction, internalQuery } from './_generated/server';

const TEST_USER_EMAIL = 'secret@secret.com';

export const getTestUser = internalQuery({
	args: {},
	handler: async (ctx) => {
		// Use Better Auth adapter to find user by email
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: TEST_USER_EMAIL }]
		});
		return user;
	}
});

export const init = internalAction({
	args: {},
	handler: async (ctx) => {
		const existingUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: TEST_USER_EMAIL }]
		});

		if (existingUser !== null) {
			console.info('Test user already exists, skipping creation');
			return;
		}

		// Create test user using Better Auth adapter
		const now = Date.now();
		await ctx.runMutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: TEST_USER_EMAIL,
					name: 'Test User',
					emailVerified: true, // Mark as verified for E2E testing
					createdAt: now,
					updatedAt: now
				}
			}
		});

		console.info('Test user created');
	}
});
