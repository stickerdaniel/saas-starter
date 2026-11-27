import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathSetNameList, pathSets } from './path-sets';

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
			'.github/actions/e2e-run/action.yml': true,
			'.github/workflows/reduced-export.yml': true,
			'.github/workflows/windows-process-lifecycle.yml': true,
			'.github/workflows/static-checks.yml': false,
			'packages/create-saas-starter/test/release-gate.test.ts': true,
			'scripts/check-reduced-export.ts': true,
			'scripts/export-profile.ts': false,
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

describe('templateProfiles', () => {
	it('declares every set this template revision can omit', () => {
		const { templateProfiles } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

		expect(isPathSetNameList(templateProfiles)).toBe(true);
		expect([...templateProfiles].sort()).toEqual(Object.keys(pathSets).sort());
	});

	it('removes only scripts that package.json has', () => {
		const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

		expect(
			Object.values(pathSets).flatMap(({ removedScripts }) =>
				removedScripts.filter((script) => !Object.hasOwn(scripts, script))
			)
		).toEqual([]);
	});
});
