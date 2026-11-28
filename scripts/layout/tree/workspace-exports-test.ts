/** `scripts/workspace-exports.test.ts` of the generated tree, which reads the tree it lies in. */
export const WORKSPACE_EXPORTS_TEST = `import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inPathSets, type WorkspaceRoot } from '../packages/tooling/src/path-sets.ts';
import {
	checkoutFiles,
	exportProblems,
	readPackageImports,
	readWorkspacePackages,
	type PackageImport,
	type WorkspacePackage
} from './workspace-exports.ts';

const checkout = fileURLToPath(new URL('..', import.meta.url));

const exports = {
	'./src/button.ts': './src/button.ts',
	'./testing/src/catalog.ts': './src/catalog.ts'
};
const ui = (entries: Record<string, string> = exports): WorkspacePackage => ({
	root: 'packages/ui/',
	name: '@repo/ui',
	exports: entries
});
const files = new Set(['packages/ui/src/button.ts', 'packages/ui/src/catalog.ts']);
const exists = (path: string) => files.has(path);

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
const imported = [appImport('@repo/ui/src/button.ts'), appTest('@repo/ui/testing/src/catalog.ts')];

describe('exportProblems', () => {
	it('passes an API entry that app code imports and a testing entry that a test imports', () => {
		expect(exportProblems([ui()], imported, exists)).toEqual([]);
	});

	it('fails an entry that no file of another workspace imports', () => {
		expect(
			exportProblems(
				[ui()],
				[
					appTest('@repo/ui/testing/src/catalog.ts'),
					{ file: 'packages/ui/src/menu.ts', specifier: '@repo/ui/src/button.ts', suite: false }
				],
				exists
			)
		).toEqual(['@repo/ui exports ./src/button.ts, which no file of another workspace imports']);
	});

	it('fails an API entry whose importers are all suite files', () => {
		expect(
			exportProblems(
				[ui()],
				[appTest('@repo/ui/src/button.ts'), appTest('@repo/ui/testing/src/catalog.ts')],
				exists
			)
		).toEqual([
			'@repo/ui exports ./src/button.ts for suite files alone (apps/web/src/page.test.ts); it belongs under ./testing/'
		]);
	});

	it('fails a specifier that resolves to no entry', () => {
		expect(
			exportProblems([ui()], [...imported, appImport('@repo/ui/src/button.js')], exists)
		).toEqual([
			'apps/web/src/page.ts imports @repo/ui/src/button.js, which no exports entry of @repo/ui names'
		]);
	});

	it('fails an entry whose value names no file', () => {
		expect(exportProblems([ui()], imported, (path) => path !== 'packages/ui/src/button.ts')).toEqual(
			['@repo/ui exports ./src/button.ts as ./src/button.ts, which names no file']
		);
	});

	it('fails an entry whose key names another file than its value', () => {
		expect(
			exportProblems([ui({ ...exports, './src/button.ts': './src/catalog.ts' })], imported, exists)
		).toContain('@repo/ui exports ./src/button.ts as ./src/catalog.ts, which is another file');
	});

	it('fails two entries of one kind for one file', () => {
		expect(
			exportProblems(
				[ui({ ...exports, './button.ts': './src/button.ts' })],
				[...imported, appImport('@repo/ui/button.ts')],
				exists
			)
		).toContain('@repo/ui exports packages/ui/src/button.ts as ./button.ts and ./src/button.ts');
	});

	it('fails an API entry and a testing entry for one file', () => {
		expect(
			exportProblems(
				[ui({ ...exports, './src/catalog.ts': './src/catalog.ts' })],
				[...imported, appImport('@repo/ui/src/catalog.ts')],
				exists
			)
		).toEqual([
			'@repo/ui exports packages/ui/src/catalog.ts as ./src/catalog.ts and ./testing/src/catalog.ts'
		]);
	});
});

describe('the exports maps of this checkout', () => {
	it('name every package import of another workspace, and nothing else', () => {
		const present = checkoutFiles(checkout);
		const packages = readWorkspacePackages(checkout, present);
		const tree = {
			layout: 'workspace' as const,
			workspaces: packages.map((workspace) => workspace.root as WorkspaceRoot)
		};
		const isSuite = (path: string) => inPathSets(tree, path, ['tests']);
		expect(
			exportProblems(packages, readPackageImports(checkout, present, packages, isSuite), (path) =>
				existsSync(join(checkout, path))
			)
		).toEqual([]);
	});
});
`;
