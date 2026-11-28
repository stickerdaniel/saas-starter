/** `scripts/workspace-exports.test.ts` of the generated tree, which reads the tree it lies in. */
export const WORKSPACE_EXPORTS_TEST = `import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inPathSets, type WorkspaceRoot } from '../packages/tooling/src/path-sets.ts';
import {
	exportProblems,
	readPackageImports,
	readWorkspacePackages,
	type PackageImport,
	type WorkspacePackage
} from './workspace-exports.ts';

const checkout = fileURLToPath(new URL('..', import.meta.url));

const ui: WorkspacePackage = {
	root: 'packages/ui/',
	name: '@repo/ui',
	exports: { './button': './src/button.ts', './testing/catalog': './src/catalog.ts' }
};

const appImport = (specifier: string): PackageImport => ({
	file: 'apps/web/src/page.ts',
	specifier,
	suite: false
});
const appTest = (specifier: string): PackageImport => ({
	file: 'apps/web/src/page.test.ts',
	specifier,
	suite: true
});

describe('exportProblems', () => {
	it('passes an API entry that app code imports and a testing entry that a test imports', () => {
		expect(
			exportProblems([ui], [appImport('@repo/ui/button'), appTest('@repo/ui/testing/catalog')])
		).toEqual([]);
	});

	it('fails an entry that no file of another workspace imports', () => {
		expect(
			exportProblems(
				[ui],
				[
					appTest('@repo/ui/testing/catalog'),
					{ file: 'packages/ui/src/menu.ts', specifier: '@repo/ui/button', suite: false }
				]
			)
		).toEqual(['@repo/ui exports ./button, which no file of another workspace imports']);
	});

	it('fails an API entry whose importers are all suite files', () => {
		expect(
			exportProblems([ui], [appTest('@repo/ui/button'), appTest('@repo/ui/testing/catalog')])
		).toEqual([
			'@repo/ui exports ./button for suite files alone (apps/web/src/page.test.ts); it belongs under ./testing/'
		]);
	});

	it('fails a specifier that resolves to no entry', () => {
		expect(
			exportProblems(
				[ui],
				[
					appImport('@repo/ui/button'),
					appTest('@repo/ui/testing/catalog'),
					appImport('@repo/ui/src/button.ts')
				]
			)
		).toEqual([
			'apps/web/src/page.ts imports @repo/ui/src/button.ts, which no exports entry of @repo/ui names'
		]);
	});
});

describe('the exports maps of this checkout', () => {
	it('name every package import of another workspace, and nothing else', () => {
		const packages = readWorkspacePackages(checkout);
		const tree = {
			layout: 'workspace' as const,
			workspaces: packages.map((workspace) => workspace.root as WorkspaceRoot)
		};
		const isSuite = (path: string) => inPathSets(tree, path, ['tests']);
		expect(exportProblems(packages, readPackageImports(checkout, packages, isSuite))).toEqual([]);
	});
});
`;
