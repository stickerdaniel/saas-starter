import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { parser } from 'typescript-eslint';
import rule from './require-session-store-cleanup.js';

function reports(code: string) {
	return new Linter()
		.verify(
			code,
			[
				{
					files: ['**/*.ts'],
					languageOptions: { parser },
					plugins: { local: { rules: { 'require-session-store-cleanup': rule } } },
					rules: { 'local/require-session-store-cleanup': 'error' }
				}
			],
			{ filename: 'example.test.ts' }
		)
		.map(({ line, message, ruleId }) => ({ line, message, ruleId }));
}

const MESSAGE =
	'Unmount the session store before the file ends, with `cleanStores(client.useSession())` in `afterAll` or `onTestFinished`, because the store cleanup runs one second after the last unsubscribe.';
const missing = (line: number) => [
	{ line, message: MESSAGE, ruleId: 'local/require-session-store-cleanup' }
];

describe('require-session-store-cleanup', () => {
	it('accepts a file that unmounts the session store of the client it creates', () => {
		expect(
			reports(`import { afterAll } from 'vitest';
import { cleanStores } from 'nanostores';
import { createAuthClient } from 'better-auth/svelte';
const client = createAuthClient({ baseURL: 'https://example.com' });
const stop = client.useSession().subscribe(() => {});
stop();
afterAll(() => cleanStores(client.useSession()));`)
		).toEqual([]);
	});

	it('reports the client of a file that reads its session store without cleanStores', () => {
		expect(
			reports(`import { createAuthClient } from 'better-auth/svelte';
const client = createAuthClient({ baseURL: 'https://example.com' });
const stop = client.useSession().subscribe(() => {});
stop();`)
		).toEqual(missing(2));
	});

	it('reports a client created from a dynamic import of another entry point', () => {
		expect(
			reports(`const state = await vi.hoisted(async () => {
	const { createAuthClient } = await import('better-auth/client');
	return { client: createAuthClient({ baseURL: 'https://example.com' }) };
});
state.client.$store.notify('$sessionSignal');`)
		).toEqual(missing(3));
	});

	it('accepts a client whose session store the file never reads', () => {
		expect(
			reports(`vi.mock('#lib/auth-client.js', async () => {
	const { createAuthClient } = await import('better-auth/client');
	return { authClient: createAuthClient({ baseURL: 'https://example.com' }) };
});`)
		).toEqual([]);
	});

	it('accepts a file that creates no Better Auth client', () => {
		expect(
			reports(`import { authClient } from '#lib/auth-client.js';
const stop = authClient.useSession().subscribe(() => {});
stop();`)
		).toEqual([]);
	});
});
