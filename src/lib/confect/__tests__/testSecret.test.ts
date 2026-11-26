// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import * as registered from '../../convex/tests';
import { convexModules } from '../convexTest.modules';

const publicHelpers = Object.entries(registered).filter(([, fn]) => fn.isPublic);

const exportedArgs = (fn: object) =>
	'exportArgs' in fn && typeof fn.exportArgs === 'function'
		? JSON.parse(String(fn.exportArgs()))
		: undefined;

const health = (secret: string) =>
	convexTest(schema, convexModules).query(api.tests.health, { secret });

afterEach(() => vi.unstubAllEnvs());

describe('E2E test helpers', () => {
	it.each(publicHelpers)('%s requires a string secret argument', (_name, fn) => {
		expect(exportedArgs(fn)?.value?.secret).toEqual({
			fieldType: { type: 'string' },
			optional: false
		});
	});

	it('answers the configured secret', async () => {
		vi.stubEnv('AUTH_E2E_TEST_SECRET', 'test-secret');
		await expect(health('test-secret')).resolves.toEqual({ ok: true });
	});

	it('refuses a wrong secret of the right shape', async () => {
		vi.stubEnv('AUTH_E2E_TEST_SECRET', 'test-secret');
		await expect(health('test-secreu')).rejects.toThrow('Unauthorized: Invalid test secret');
	});

	it('refuses every secret when none is configured', async () => {
		vi.stubEnv('AUTH_E2E_TEST_SECRET', undefined);
		for (const secret of ['', 'undefined', 'test-secret']) {
			await expect(health(secret)).rejects.toThrow('Unauthorized: Invalid test secret');
		}
	});
});
