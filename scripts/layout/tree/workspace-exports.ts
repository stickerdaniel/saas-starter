import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import ts from 'typescript';

export interface WorkspacePackage {
	readonly root: `${string}/`;
	readonly name: string;
	readonly exports: Readonly<Record<string, string>>;
}

export interface PackageImport {
	readonly file: string;
	readonly specifier: string;
	readonly suite: boolean;
}

const TESTING = './testing/';
const SCANNED = /\.(?:[cm]?[jt]s|[jt]sx|svelte)$/;
const MODULE_CALLS = new Set([
	'require',
	'vi.mock',
	'vi.doMock',
	'vi.unmock',
	'vi.importActual',
	'vi.importMock'
]);

function scripts(path: string, text: string): string[] {
	if (!path.endsWith('.svelte')) return [text];
	return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);
}

/** The module specifiers a file names in imports, exports, `import()`, `require` and mocks. */
export function moduleSpecifiers(path: string, text: string): string[] {
	const found: string[] = [];
	for (const code of scripts(path, text)) {
		const kind = /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
		const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, false, kind);
		const visit = (node: ts.Node): void => {
			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
			) {
				found.push(node.moduleSpecifier.text);
			} else if (
				ts.isImportTypeNode(node) &&
				ts.isLiteralTypeNode(node.argument) &&
				ts.isStringLiteral(node.argument.literal)
			) {
				found.push(node.argument.literal.text);
			} else if (ts.isCallExpression(node)) {
				const [first] = node.arguments;
				const named =
					node.expression.kind === ts.SyntaxKind.ImportKeyword ||
					MODULE_CALLS.has(node.expression.getText(source));
				if (named && first && ts.isStringLiteralLike(first)) found.push(first.text);
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return found;
}

function subpathOf(name: string, specifier: string): string | undefined {
	const bare = specifier.split('?')[0]!;
	if (bare === name) return '.';
	return bare.startsWith(`${name}/`) ? `./${bare.slice(name.length + 1)}` : undefined;
}

function matches(key: string, subpath: string): boolean {
	const star = key.indexOf('*');
	if (star === -1) return key === subpath;
	return subpath.startsWith(key.slice(0, star)) && subpath.endsWith(key.slice(star + 1));
}

/**
 * Why the `exports` maps of `packages` do not fit the imports of the tree: an entry that no file
 * of another workspace imports, an entry outside `./testing/` that only suite files import, and a
 * package specifier that names no entry.
 */
export function exportProblems(
	packages: readonly WorkspacePackage[],
	imports: readonly PackageImport[]
): string[] {
	const problems: string[] = [];
	const importers = new Map<string, PackageImport[]>();
	for (const item of imports) {
		for (const workspace of packages) {
			const subpath = subpathOf(workspace.name, item.specifier);
			if (subpath === undefined || item.file.startsWith(workspace.root)) continue;
			const key = Object.keys(workspace.exports).find((entry) => matches(entry, subpath));
			if (key === undefined) {
				problems.push(
					`${item.file} imports ${item.specifier}, which no exports entry of ${workspace.name} names`
				);
				continue;
			}
			const id = `${workspace.name}\t${key}`;
			importers.set(id, [...(importers.get(id) ?? []), item]);
		}
	}
	for (const workspace of packages) {
		for (const key of Object.keys(workspace.exports)) {
			const found = importers.get(`${workspace.name}\t${key}`) ?? [];
			if (!found.length) {
				problems.push(
					`${workspace.name} exports ${key}, which no file of another workspace imports`
				);
			} else if (!key.startsWith(TESTING) && found.every((item) => item.suite)) {
				problems.push(
					`${workspace.name} exports ${key} for suite files alone (${found.map((item) => item.file).join(', ')}); it belongs under ${TESTING}`
				);
			}
		}
	}
	return problems.sort();
}

function presentFiles(checkout: string): string[] {
	const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
		cwd: checkout,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024
	});
	if (listed.status !== 0) throw new Error(`git ls-files failed in ${checkout}: ${listed.stderr}`);
	return [...new Set(listed.stdout.split('\0'))]
		.filter(
			(path) => path && existsSync(join(checkout, path)) && statSync(join(checkout, path)).isFile()
		)
		.sort();
}

/** The member packages of the root manifest's `workspaces`, with their `exports` maps. */
export function readWorkspacePackages(checkout: string): WorkspacePackage[] {
	const root: { workspaces?: string[] } = JSON.parse(
		readFileSync(join(checkout, 'package.json'), 'utf8')
	);
	const member = (path: string) =>
		(root.workspaces ?? []).some((pattern) =>
			pattern.endsWith('/*')
				? posix.dirname(posix.dirname(path)) === pattern.slice(0, -2)
				: posix.dirname(path) === pattern
		);
	return presentFiles(checkout)
		.filter((path) => path.endsWith('/package.json') && member(path))
		.map((path) => {
			const manifest: { name: string; exports?: Record<string, string> | string } = JSON.parse(
				readFileSync(join(checkout, path), 'utf8')
			);
			const exports =
				typeof manifest.exports === 'string' ? { '.': manifest.exports } : (manifest.exports ?? {});
			return { root: `${posix.dirname(path)}/` as const, name: manifest.name, exports };
		});
}

/** Every import of a workspace package by name in the checkout. */
export function readPackageImports(
	checkout: string,
	packages: readonly WorkspacePackage[],
	isSuite: (path: string) => boolean
): PackageImport[] {
	const names = packages.map((workspace) => workspace.name);
	return presentFiles(checkout)
		.filter((path) => SCANNED.test(path) && !path.split('/').includes('node_modules'))
		.flatMap((file) =>
			moduleSpecifiers(file, readFileSync(join(checkout, file), 'utf8'))
				.filter((specifier) => names.some((name) => subpathOf(name, specifier) !== undefined))
				.map((specifier) => ({ file, specifier, suite: isSuite(file) }))
		);
}
