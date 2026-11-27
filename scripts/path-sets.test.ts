import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAT_TREE, inPathSets, isPathSetNameList, pathSets, type Tree } from './path-sets';

const root = join(import.meta.dirname, '..');
const tracked = (...pathspecs: string[]) =>
	execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], { cwd: root, encoding: 'utf8' })
		.split('\0')
		.filter(Boolean);
const confectModules = tracked('src/lib/confect/*.ts');
const declaration =
	/^export default (?:GroupSpec\.make\(|class \w+ extends MiddlewareSpec\.MiddlewareSpec<)/m;
const workspaceTree: Tree = {
	layout: 'workspace',
	workspaces: [
		'',
		'apps/web/',
		'packages/backend/',
		'packages/ui/',
		'packages/emails/',
		'packages/product-config/',
		'packages/tooling/',
		'packages/eslint-plugin/',
		'packages/create-saas-starter/'
	]
};
const inTests = (tree: Tree) => (path: string) => inPathSets(tree, path, ['tests']);

describe('the tests set', () => {
	it('keeps every Confect declaration, including the ones named *.spec.ts', () => {
		const declarations = confectModules.filter((path) =>
			declaration.test(readFileSync(join(root, path), 'utf8'))
		);

		expect(declarations).toEqual(confectModules.filter((path) => path.endsWith('.spec.ts')));
		expect(declarations.filter(inTests(FLAT_TREE))).toEqual([]);
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
			Object.fromEntries(Object.keys(paths).map((path) => [path, inTests(FLAT_TREE)(path)]))
		).toEqual(paths);
	});

	it('keeps a Confect declaration of the backend workspace and removes a spec of the UI workspace', () => {
		expect(
			[
				'packages/backend/confect/admin/auditLog/queries.spec.ts',
				'packages/backend/confect/admin/auditLog/queries.test.ts',
				'packages/backend/convex/schema.spec.ts',
				'packages/ui/src/components/ui/button/button.spec.ts',
				'packages/ui/confect/x.spec.ts',
				'packages/voice/src/x.spec.ts',
				'scripts/check-workspace-graph.ts'
			].filter(inTests(workspaceTree))
		).toEqual([
			'packages/backend/confect/admin/auditLog/queries.test.ts',
			'packages/backend/convex/schema.spec.ts',
			'packages/ui/src/components/ui/button/button.spec.ts',
			'packages/ui/confect/x.spec.ts',
			'packages/voice/src/x.spec.ts'
		]);
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
