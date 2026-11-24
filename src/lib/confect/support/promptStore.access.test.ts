// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { convexModules } from '../convexTest.modules';

const { promptStore } = internal.support;

describe('support prompt store on the backend', () => {
	it('activates a saved prompt by the id it returned', async () => {
		const t = convexTest(schema, convexModules);
		const first = await t.mutation(promptStore.savePrompt, { systemPrompt: 'v1', locale: 'de' });
		await t.mutation(promptStore.savePrompt, { systemPrompt: 'v2', locale: 'de' });

		await expect(t.query(promptStore.getActive, { locale: 'de' })).resolves.toBe('v2');
		await expect(
			t.mutation(promptStore.setActive, { id: first, active: true })
		).resolves.toBeNull();
		await expect(t.query(promptStore.getActive, { locale: 'de' })).resolves.toBe('v1');
		expect(await t.run((ctx) => ctx.db.get('supportAgentPrompts', first))).toMatchObject({
			systemPrompt: 'v1',
			locale: 'de',
			active: true
		});
	});
});
