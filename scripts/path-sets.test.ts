import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathSets } from './path-sets';

const root = join(import.meta.dirname, '..');
const confectModules = execFileSync('git', ['ls-files', '-z', '--', 'src/lib/confect/*.ts'], {
	cwd: root,
	encoding: 'utf8'
})
	.split('\0')
	.filter(Boolean);
const declaration =
	/^export default (?:GroupSpec\.make\(|class \w+ extends MiddlewareSpec\.MiddlewareSpec<)/m;

describe('the tests set', () => {
	it('keeps every Confect declaration, including the ones named *.spec.ts', () => {
		const declarations = confectModules.filter((path) =>
			declaration.test(readFileSync(join(root, path), 'utf8'))
		);

		expect(declarations).toEqual(confectModules.filter((path) => path.endsWith('.spec.ts')));
		expect(declarations.filter(pathSets.tests.includes)).toEqual([]);
	});

	it('removes tests, E2E and their support, and keeps the browser fixture harnesses', () => {
		const paths = {
			'e2e/public-a11y.spec.ts': true,
			'playwright.config.ts': true,
			'src/lib/confect/admin/auditLog/queries.test.ts': true,
			'scripts/__fixtures__/static-checks/private-checkout.ts': true,
			'src/lib/confect/admin/journey/journeyStore.fixtures.ts': true,
			'src/lib/components/tables/test-fixtures/TableScrollHarness.svelte': false,
			'src/lib/effect/vitest.ts': false,
			'scripts/static-checks.ts': false
		};

		expect(
			Object.fromEntries(Object.keys(paths).map((path) => [path, pathSets.tests.includes(path)]))
		).toEqual(paths);
	});
});
