import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../support/agent', () => ({ supportAgent: {} }));
import * as testHelpers from '../tests';

type Registered = {
	isPublic?: boolean;
	exportArgs?: () => string;
	_handler: (ctx: unknown, args: unknown) => unknown;
};

/** Every public function in tests.ts; each one must refuse a caller without the E2E secret. */
const publicHelpers = Object.entries(testHelpers as unknown as Record<string, Registered>).filter(
	([, fn]) => fn.isPublic
);

/** A context that fails the test on any use, so a refusal must come before every read and write. */
const untouchableCtx = new Proxy(
	{},
	{
		get: (_target, property) => {
			throw new Error(`ctx.${String(property)} used before the secret check`);
		}
	}
);

afterEach(() => vi.unstubAllEnvs());

describe('E2E test helpers', () => {
	it.each(publicHelpers)('%s requires a string secret argument', (_name, fn) => {
		const args = JSON.parse(fn.exportArgs?.() ?? '{}');
		expect(args.value?.secret).toEqual({ fieldType: { type: 'string' }, optional: false });
	});

	it.each(publicHelpers)('%s refuses a wrong secret of the right shape', async (_name, fn) => {
		vi.stubEnv('AUTH_E2E_TEST_SECRET', 'test-secret');
		await expect(async () =>
			fn._handler(untouchableCtx, { secret: 'test-secreu' })
		).rejects.toThrow('Unauthorized: Invalid test secret');
	});

	it.each(publicHelpers)('%s refuses every secret when none is configured', async (_name, fn) => {
		vi.stubEnv('AUTH_E2E_TEST_SECRET', undefined);
		for (const secret of ['', 'undefined', 'test-secret']) {
			await expect(async () => fn._handler(untouchableCtx, { secret })).rejects.toThrow(
				'Unauthorized: Invalid test secret'
			);
		}
	});
});
