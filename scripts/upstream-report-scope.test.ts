import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import suiteConfig from '../.agents/skills/upstream-report/scripts/vitest.config';
import {
	UPSTREAM_REPORT_TEST_INPUTS,
	isUpstreamReportTestInput,
	selectUpstreamReportTests
} from './upstream-report-scope';

const ROOT = path.resolve(import.meta.dirname, '..');
const SUITE_CONFIG = '.agents/skills/upstream-report/scripts/vitest.config.ts';

type Value = { anchored: true; path: string } | { anchored: false; text: string };

/**
 * Repository paths a source file reaches: its relative imports, and the path expressions
 * this scan can evaluate. Those are `resolve`/`join` calls and `new URL(…, import.meta.url)`
 * anchored at `import.meta.dirname` or `process.cwd()` (the suite runs from the checkout
 * root), directly or through `const` names bound to such an expression.
 *
 * It cannot see a path assembled at run time (a parameter, a loop variable, a value another
 * module exports), the listing of a directory, or a child process reading the checkout.
 * Names are matched by text rather than scope, so shadowing can only add a reported path.
 */
function reachedPaths(file: string): string[] {
	const absolute = path.join(ROOT, file);
	const directory = path.dirname(absolute);
	const source = ts.createSourceFile(
		absolute,
		readFileSync(absolute, 'utf8'),
		ts.ScriptTarget.Latest,
		true
	);
	const bound = new Map<string, string>();
	const reached = new Set<string>();

	const isMeta = (node: ts.Node | undefined, property: string) =>
		node !== undefined &&
		ts.isPropertyAccessExpression(node) &&
		ts.isMetaProperty(node.expression) &&
		node.name.text === property;

	function evaluate(node: ts.Expression): Value | undefined {
		if (ts.isStringLiteralLike(node)) return { anchored: false, text: node.text };
		if (ts.isParenthesizedExpression(node)) return evaluate(node.expression);
		if (isMeta(node, 'dirname')) return { anchored: true, path: directory };
		if (ts.isIdentifier(node)) {
			const value = bound.get(node.text);
			return value === undefined ? undefined : { anchored: true, path: value };
		}
		if (ts.isCallExpression(node)) {
			const callee = node.expression.getText(source);
			if (callee === 'process.cwd') return { anchored: true, path: ROOT };
			if (!/^(?:path\.)?(?:resolve|join)$/.test(callee)) return undefined;
			const [base, ...segments] = node.arguments.map(evaluate);
			const texts = segments.flatMap((segment) =>
				segment?.anchored === false ? [segment.text] : []
			);
			if (!base?.anchored || texts.length !== segments.length) return undefined;
			return { anchored: true, path: path.resolve(base.path, ...texts) };
		}
		if (ts.isNewExpression(node) && node.expression.getText(source) === 'URL') {
			const [specifier, base] = node.arguments ?? [];
			const value = specifier && evaluate(specifier);
			if (value?.anchored === false && isMeta(base, 'url')) {
				return { anchored: true, path: path.resolve(directory, value.text) };
			}
		}
		return undefined;
	}

	function record(target: string): void {
		const relative = path.relative(ROOT, target);
		if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return;
		// Installed packages follow from the manifest and lockfile, which the scope lists.
		if (relative.split(path.sep)[0] === 'node_modules') return;
		// A directory is a base the next join builds on, not something read.
		if (existsSync(target) && statSync(target).isDirectory()) return;
		reached.add(relative.split(path.sep).join('/'));
	}

	function recordImport(specifier: string): void {
		if (!specifier.startsWith('.')) return;
		const target = path.resolve(directory, specifier);
		const candidates = [target, `${target}.ts`, `${target}.js`, path.join(target, 'index.ts')];
		record(candidates.find((candidate) => existsSync(candidate)) ?? target);
	}

	function visit(node: ts.Node): void {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			recordImport(node.moduleSpecifier.text);
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments[0] &&
			ts.isStringLiteralLike(node.arguments[0])
		) {
			recordImport(node.arguments[0].text);
		}
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.initializer &&
			node.parent.flags & ts.NodeFlags.Const
		) {
			const value = evaluate(node.initializer);
			if (value?.anchored) bound.set(node.name.text, value.path);
		}
		if (ts.isExpression(node)) {
			const value = evaluate(node);
			if (value?.anchored) record(value.path);
		}
		ts.forEachChild(node, visit);
	}

	visit(source);
	return [...reached];
}

/** Every string in the suite's Vitest config that names a repository file, such as `tsconfig`. */
function configPaths(value: unknown): string[] {
	if (typeof value === 'string') {
		const target = path.resolve(ROOT, value);
		return existsSync(target) && statSync(target).isFile()
			? [path.relative(ROOT, target).split(path.sep).join('/')]
			: [];
	}
	if (Array.isArray(value)) return value.flatMap(configPaths);
	if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(configPaths);
	return [];
}

describe('upstream report test inputs', () => {
	const include = suiteConfig.test?.include ?? [];
	const found = new Set([SUITE_CONFIG, ...include, ...configPaths(suiteConfig)]);
	// A Set visits what is added while iterating, so this follows every reached source file
	// and covers an import the detector or the shared settings gain later.
	for (const file of found) {
		if (/\.[cm]?[jt]s$/.test(file) && existsSync(path.join(ROOT, file))) {
			for (const next of reachedPaths(file)) found.add(next);
		}
	}
	const reached = [...found].sort();

	it('reads the suite as files the scan can open', () => {
		expect(include.length).toBeGreaterThan(0);
		for (const file of include) {
			expect(existsSync(path.join(ROOT, file)), `${file}: expand globs before scanning`).toBe(true);
		}
	});

	it('sees the configuration readers it exists to guard (scanner sanity check)', () => {
		expect(reached).toEqual(
			expect.arrayContaining([
				'package.json',
				'.github/workflows/static-checks.yml',
				'scripts/vitest-settings.ts',
				'tsconfig.tooling.json'
			])
		);
	});

	// Without it, Vite transforms each test with the nearest tsconfig.json, which extends the
	// root one and SvelteKit's generated config. No import or read names that file.
	it('pins its tsconfig so the scan sees it', () => {
		expect(suiteConfig.tsconfig).toBeDefined();
	});

	it('covers every repository path the suite reaches', () => {
		expect(
			reached.filter((file) => !isUpstreamReportTestInput(file)),
			'add these to UPSTREAM_REPORT_TEST_INPUTS, or the job skips changes the suite depends on'
		).toEqual([]);
	});

	it('lists only inputs that exist', () => {
		for (const input of UPSTREAM_REPORT_TEST_INPUTS) {
			expect(existsSync(path.join(ROOT, input)), input).toBe(true);
		}
	});
});

describe('upstream report test selection', () => {
	it('imports Node built-ins only, because the job runs it before installing', () => {
		const file = path.join(import.meta.dirname, 'upstream-report-scope.ts');
		const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
		const specifiers = source.statements.flatMap((statement) =>
			ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
				? [statement.moduleSpecifier.text]
				: []
		);
		expect(specifiers.length).toBeGreaterThan(0);
		expect(specifiers.filter((specifier) => !specifier.startsWith('node:'))).toEqual([]);
	});

	const entry = (filename: string, previous?: string) => ({
		sha: 'b'.repeat(40),
		filename,
		status: previous ? 'renamed' : 'modified',
		...(previous ? { previous_filename: previous } : {})
	});
	const pullRequest = (
		pages: unknown,
		changedFiles = String((pages as unknown[][]).flat().length)
	) =>
		selectUpstreamReportTests({
			eventName: 'pull_request',
			changedFiles,
			readPages: () => pages
		});

	it('skips a pull request that changes only documentation', () => {
		expect(pullRequest([[entry('README.md'), entry('docs/AGENTS.md')]]).run).toBe(false);
	});

	it.each([
		'.agents/skills/upstream-report/SKILL.md',
		'bun.lock',
		'.github/workflows/static-checks.yml'
	])('runs when a pull request changes %s', (file) => {
		expect(pullRequest([[entry('README.md')], [entry(file)]]).run).toBe(true);
	});

	it('runs when a rename moves an input out of scope', () => {
		const rename = entry(
			'docs/upstream-relevance.ts',
			'.agents/skills/upstream-report/scripts/upstream-relevance.ts'
		);
		expect(pullRequest([[rename]]).run).toBe(true);
	});

	it('runs when the file list is incomplete', () => {
		expect(pullRequest([[entry('README.md')]], '2').run).toBe(true);
	});

	it.each([
		[
			'an unreadable list',
			() => {
				throw new Error('HTTP 502');
			}
		],
		['a malformed list', () => [{ filename: 'README.md' }]],
		['an entry without a path', () => [[{ status: 'modified' }]]]
	])('runs on %s', (_label, readPages) => {
		expect(
			selectUpstreamReportTests({ eventName: 'pull_request', changedFiles: '1', readPages }).run
		).toBe(true);
	});

	it('runs when the event carries no changed-file count', () => {
		expect(pullRequest([[entry('README.md')]], '').run).toBe(true);
	});

	it.each(['push', 'workflow_dispatch', 'merge_group'])(
		'runs on %s whatever changed',
		(eventName) => {
			const readPages = vi.fn(() => [[entry('README.md')]]);
			expect(selectUpstreamReportTests({ eventName, changedFiles: '1', readPages }).run).toBe(true);
			expect(readPages).not.toHaveBeenCalled();
		}
	);

	it('runs on a docs-only pull request while CI_FULL_SUITE is set', () => {
		const readPages = () => [[entry('README.md')]];
		const select = (fullSuite: string) =>
			selectUpstreamReportTests({
				fullSuite,
				eventName: 'pull_request',
				changedFiles: '1',
				readPages
			}).run;
		expect(select('')).toBe(false);
		expect(select('true')).toBe(true);
	});
});
