// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';
import schema from '../../convex/schema';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);
const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};

// The browser tells a signed-out caller from any other failure by this error.
const unauthenticated = (error: unknown) =>
	error instanceof ConvexError && error.data === 'Unauthenticated';

describe('a caller without a session', () => {
	it('gets Unauthenticated from a raw registration', async () => {
		await expect(harness().query(api.users.viewer, {})).rejects.toSatisfy(unauthenticated);
	});

	it('gets Unauthenticated from a custom builder registration', async () => {
		await expect(
			harness().query(api.aiChat.messages.getFileMetadataBatch, { urls: [] })
		).rejects.toSatisfy(unauthenticated);
	});
});
