// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { components, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

const findUser = (t: Harness, email: string) =>
	t.query(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: 'email', operator: 'eq', value: email }]
	});

const preferences = (t: Harness) =>
	t.run(async (ctx) => await ctx.db.query('adminNotificationPreferences').take(10));

async function createUser(t: Harness, email: string) {
	const now = Date.now();
	return (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				name: 'Ada',
				email,
				emailVerified: false,
				role: 'user',
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
}

beforeEach(() => {
	vi.stubEnv('SITE_URL', 'https://example.test');
	vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-test-secret-test-secret');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('localDev:ensureSeededAdmin', () => {
	beforeEach(() => {
		vi.stubEnv('LOCAL_CONVEX_DEV', 'true');
		vi.stubEnv('LOCAL_SEEDED_ADMIN_EMAIL', ' Admin@Local.Dev ');
		vi.stubEnv('LOCAL_SEEDED_ADMIN_PASSWORD', 'Local-Admin-Password-1');
		vi.stubEnv('LOCAL_SEEDED_ADMIN_NAME', 'Local Admin');
	});

	it('creates a verified admin once and then skips', async () => {
		const t = harness();
		await expect(t.mutation(internal.localDev.ensureSeededAdmin, {})).resolves.toEqual({
			created: true,
			updatedRole: false,
			updatedVerification: true,
			skipped: false
		});
		await expect(t.mutation(internal.localDev.ensureSeededAdmin, {})).resolves.toEqual({
			created: false,
			updatedRole: false,
			updatedVerification: false,
			skipped: true
		});

		const user = await findUser(t, 'admin@local.dev');
		expect(user).toMatchObject({ name: 'Local Admin', role: 'admin', emailVerified: true });
		expect(await preferences(t)).toEqual([
			expect.objectContaining({ email: 'admin@local.dev', isAdminUser: true })
		]);
	});

	it('refuses outside a local dev backend and writes nothing', async () => {
		vi.stubEnv('LOCAL_CONVEX_DEV', 'false');
		const t = harness();
		await expect(t.mutation(internal.localDev.ensureSeededAdmin, {})).rejects.toThrow(
			'localDev:ensureSeededAdmin can only run when LOCAL_CONVEX_DEV=true'
		);
		expect(await findUser(t, 'admin@local.dev')).toBeNull();
	});

	it('names a missing seed variable', async () => {
		vi.stubEnv('LOCAL_SEEDED_ADMIN_NAME', ' ');
		const t = harness();
		await expect(t.mutation(internal.localDev.ensureSeededAdmin, {})).rejects.toThrow(
			'Missing required local seed environment variable: LOCAL_SEEDED_ADMIN_NAME'
		);
		expect(await findUser(t, 'admin@local.dev')).toBeNull();
	});
});

describe('previewDev:ensurePreviewAdmin', () => {
	beforeEach(() => {
		vi.stubEnv('LOCAL_CONVEX_DEV', 'false');
		vi.stubEnv('PREVIEW_ADMIN_PASSWORD', 'Preview-Admin-Password-1');
	});

	it('promotes and verifies an existing preview user', async () => {
		const t = harness();
		const { _id } = await createUser(t, 'admin@preview.dev');
		await expect(t.mutation(internal.previewDev.ensurePreviewAdmin, {})).resolves.toEqual({
			created: false,
			updatedRole: true,
			updatedVerification: true,
			skipped: false
		});
		expect(await findUser(t, 'admin@preview.dev')).toMatchObject({
			_id,
			role: 'admin',
			emailVerified: true
		});
		expect(await preferences(t)).toEqual([
			expect.objectContaining({ email: 'admin@preview.dev', userId: _id })
		]);
	});

	it('refuses on a local dev backend and without a password', async () => {
		const t = harness();
		vi.stubEnv('LOCAL_CONVEX_DEV', 'true');
		await expect(t.mutation(internal.previewDev.ensurePreviewAdmin, {})).rejects.toThrow(
			'previewDev:ensurePreviewAdmin is for preview deployments only.'
		);
		vi.stubEnv('LOCAL_CONVEX_DEV', 'false');
		vi.stubEnv('PREVIEW_ADMIN_PASSWORD', '');
		await expect(t.mutation(internal.previewDev.ensurePreviewAdmin, {})).rejects.toThrow(
			'previewDev:ensurePreviewAdmin requires PREVIEW_ADMIN_PASSWORD env var to be set'
		);
		expect(await findUser(t, 'admin@preview.dev')).toBeNull();
	});
});
