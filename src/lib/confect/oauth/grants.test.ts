// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { createFunctionHandle } from 'convex/server';
import { describe, expect, it } from 'vitest';
import { components, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);

const CLIENT_ID = 'client-under-test';

async function harness() {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	const onCreateHandle = await t.run(() => createFunctionHandle(internal.auth.onCreate));
	const now = Date.now();
	const user = await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				name: 'Grant Owner',
				email: 'grant-owner@example.test',
				emailVerified: true,
				createdAt: now,
				updatedAt: now
			}
		}
	});
	const userId = String(user._id);
	await t.run((ctx) => ctx.db.insert('oauthGrantEpochs', { userId, epoch: 1 }));

	const createConsent = (referenceId: string) =>
		t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'oauthConsent',
				data: {
					clientId: CLIENT_ID,
					userId,
					referenceId,
					scopes: ['mcp:read', 'offline_access'],
					createdAt: now,
					updatedAt: now
				}
			},
			onCreateHandle
		});

	const createRefreshToken = (
		referenceId: string,
		scopes: string[] = ['mcp:read', 'offline_access']
	) =>
		t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'oauthRefreshToken',
				data: {
					token: `hashed-${referenceId}`,
					clientId: CLIENT_ID,
					userId,
					referenceId,
					scopes,
					createdAt: now,
					expiresAt: now + 60_000
				}
			},
			onCreateHandle
		});

	const rows = async (model: 'oauthConsent' | 'oauthRefreshToken') => {
		const result = await t.query(components.betterAuth.adapter.findMany, {
			model,
			where: [{ field: 'userId', operator: 'eq', value: userId }],
			paginationOpts: { cursor: null, numItems: 100 }
		});
		return result.page.map((row: { referenceId?: string | null }) => row.referenceId);
	};

	return { createConsent, createRefreshToken, rows };
}

describe('the grant guards', () => {
	it('reject a consent with a reference below the current epoch and keep the fresh grant', async () => {
		const { createConsent, rows } = await harness();
		await createConsent('1');

		await expect(createConsent('0')).rejects.toMatchObject({
			data: { code: 'oauth_consent_stale_reference' }
		});
		expect(await rows('oauthConsent')).toEqual(['1']);
	});

	it('reject a refresh token for a grant without a consent and write no row', async () => {
		const { createConsent, createRefreshToken, rows } = await harness();
		await createConsent('1');

		await expect(createRefreshToken('0')).rejects.toMatchObject({
			data: { code: 'oauth_refresh_without_grant' }
		});
		await createRefreshToken('1');
		expect(await rows('oauthRefreshToken')).toEqual(['1']);
	});

	it('reject a refresh token with a scope the consent lacks and write no row', async () => {
		const { createConsent, createRefreshToken, rows } = await harness();
		await createConsent('1');

		await expect(
			createRefreshToken('1', ['mcp:read', 'mcp:write', 'offline_access'])
		).rejects.toMatchObject({ data: { code: 'oauth_refresh_without_grant' } });
		expect(await rows('oauthRefreshToken')).toEqual([]);
		await createRefreshToken('1', ['mcp:read']);
		expect(await rows('oauthRefreshToken')).toEqual(['1']);
	});
});
