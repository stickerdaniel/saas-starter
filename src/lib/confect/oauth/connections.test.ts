// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);

const HOUR = 60 * 60 * 1000;
const USER = 'user-under-test';
const CLIENT = 'client-under-test';
const START = Date.UTC(2026, 10, 27, 9);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	const consent = (referenceId: string) =>
		t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'oauthConsent',
				data: {
					clientId: CLIENT,
					userId: USER,
					referenceId,
					scopes: ['mcp:read'],
					createdAt: START,
					updatedAt: START
				}
			}
		});
	const recordUse = (grant: string, at: number) =>
		t.mutation(internal.oauth.connections.recordUse, { userId: USER, clientId: CLIENT, grant, at });
	const uses = () =>
		t.run((ctx) =>
			ctx.db
				.query('oauthConnectionUses')
				.take(10)
				.then((rows) =>
					rows.map(({ userId, clientId, grant, lastUsedAt }) => ({
						userId,
						clientId,
						grant,
						lastUsedAt
					}))
				)
		);
	return { t, consent, recordUse, uses };
};

const row = (grant: string, lastUsedAt: number) => ({
	userId: USER,
	clientId: CLIENT,
	grant,
	lastUsedAt
});

describe('recordUse', () => {
	it('writes once per interval and never moves the value backwards', async () => {
		const { consent, recordUse, uses } = harness();
		await consent('0');
		await recordUse('0', START);
		expect(await uses()).toEqual([row('0', START)]);
		await recordUse('0', START + HOUR - 1);
		expect(await uses()).toEqual([row('0', START)]);
		await recordUse('0', START - HOUR);
		expect(await uses()).toEqual([row('0', START)]);
		await recordUse('0', START + HOUR);
		expect(await uses()).toEqual([row('0', START + HOUR)]);
	});

	it('writes nothing without the consent of that grant', async () => {
		const { consent, recordUse, uses } = harness();
		await consent('0');
		await recordUse('1', START);
		expect(await uses()).toEqual([]);
	});

	it('replaces the row for a new grant of the same client', async () => {
		const { consent, recordUse, uses } = harness();
		await consent('0');
		await recordUse('0', START);
		await consent('1');
		await recordUse('1', START + 1);
		expect(await uses()).toEqual([row('1', START + 1)]);
	});
});

describe('eraseUserGrants', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('deletes more than one page of the use rows of the user and keeps those of others', async () => {
		vi.useFakeTimers();
		const { t } = harness();
		await t.run(async (ctx) => {
			for (let index = 0; index < 130; index++) {
				await ctx.db.insert('oauthConnectionUses', {
					...row('0', START),
					clientId: `client-${index}`
				});
			}
			await ctx.db.insert('oauthConnectionUses', { ...row('0', START), userId: 'someone-else' });
			await ctx.db.insert('oauthGrantEpochs', { userId: USER, epoch: 1 });
		});
		await t.mutation(internal.oauth.cleanup.eraseUserGrants, { userId: USER });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const left = await t.run(async (ctx) => ({
			uses: (await ctx.db.query('oauthConnectionUses').take(200)).map(({ userId }) => userId),
			epochs: (await ctx.db.query('oauthGrantEpochs').take(10)).length
		}));
		expect(left).toEqual({ uses: ['someone-else'], epochs: 0 });
	});
});

describe('endpoint', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('returns the resource of the protected resource metadata', async () => {
		vi.stubEnv('CONVEX_SITE_URL', 'https://deployment.example.test');
		vi.stubEnv('MCP_PUBLIC_ORIGIN', 'https://mcp.example.test');
		const { t } = harness();
		const now = Date.now();
		const user = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					name: 'Ada',
					email: 'ada@example.test',
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
		const caller = t.withIdentity({ subject: user._id, sessionId: session._id });

		const metadata = await t.fetch('/.well-known/oauth-protected-resource/mcp');
		const { resource } = (await metadata.json()) as { resource: string };
		const { url } = await caller.query(api.oauth.connections.endpoint, {});
		expect(url).toBe('https://mcp.example.test/mcp');
		expect(url).toBe(resource);
	});
});
