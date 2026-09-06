// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { betterAuth } from 'better-auth';
import { createClient } from '@convex-dev/better-auth';
import { components } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import { createSchemaGenerationContext } from './schema-generation-context';

describe('Better Auth schema-generation context adapter', () => {
	it('advertises no runtime capabilities and fails every attempted context read', () => {
		const ctx = createSchemaGenerationContext();
		expect('runMutation' in ctx).toBe(false);
		expect('runQuery' in ctx).toBe(false);
		expect(() => ctx.runQuery).toThrow('Schema generation has no Convex runtime context: runQuery');
	});
	it('allows the real vendor adapter to initialize schema inspection, not database operations', async () => {
		const component = createClient<DataModel>(components.betterAuth);
		const auth = betterAuth({
			baseURL: 'https://schema.example.test',
			secret: 'schema-test-secret-at-least-thirty-two-characters',
			database: component.adapter(createSchemaGenerationContext())
		});
		const context = await auth.$context;
		expect(context.adapter.id).toBe('convex');
		expect(context.adapter.createSchema).toBeTypeOf('function');
		await expect(
			context.adapter.findOne({
				model: 'user',
				where: [{ field: 'email', value: 'a@example.test' }]
			})
		).rejects.toThrow('Schema generation has no Convex runtime context: runQuery');
	});
});
