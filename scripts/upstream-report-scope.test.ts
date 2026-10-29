import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
	UPSTREAM_REPORT_TEST_INPUTS,
	isUpstreamReportTestInput,
	selectUpstreamReportTests
} from './upstream-report-scope';

const ROOT = path.resolve(import.meta.dirname, '..');

interface Step {
	id?: string;
	uses?: string;
	run?: string;
	with?: Record<string, unknown>;
}

const steps =
	(
		parseYaml(readFileSync(path.join(ROOT, '.github/workflows/static-checks.yml'), 'utf8')) as {
			jobs: Record<string, { steps?: Step[] } | undefined>;
		}
	).jobs['upstream-report-tests']?.steps ?? [];

describe('upstream report test inputs', () => {
	it('checks out exactly the inputs in the job', () => {
		const checkouts = steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
		expect(checkouts).toHaveLength(1);
		const options = checkouts[0]?.with ?? {};
		// Cone mode always checks out every root file, which would hide a read of one.
		expect(options['sparse-checkout-cone-mode']).toBe(false);
		const patterns = String(options['sparse-checkout'] ?? '')
			.split('\n')
			.map((pattern) => pattern.trim())
			.filter(Boolean);
		// Without a leading slash, `package.json` and `patches/` would match at any depth;
		// a `**/` entry is meant to, and is checked out as written.
		const inputs = UPSTREAM_REPORT_TEST_INPUTS.map((input) =>
			input.startsWith('**/') ? input : `/${input}`
		);
		expect({
			missing: inputs.filter((input) => !patterns.includes(input)),
			extra: patterns.filter((pattern) => !inputs.includes(pattern))
		}).toEqual({ missing: [], extra: [] });
	});

	it('checks out the selection it runs', () => {
		const command = steps.find((step) => step.id === 'scope')?.run?.trim() ?? '';
		const script = /^bun (\S+)$/.exec(command)?.[1];
		expect(script, command).toBeDefined();
		expect(isUpstreamReportTestInput(script ?? ''), script).toBe(true);
	});

	it('lists only inputs that exist', () => {
		// A `**/` entry also covers files that do not exist yet.
		for (const input of UPSTREAM_REPORT_TEST_INPUTS.filter((input) => !input.startsWith('**/'))) {
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

	it('runs when a pull request changes only an attributes file below the root', () => {
		expect(pullRequest([[entry('.agents/.gitattributes')]]).run).toBe(true);
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

	// Each of these matches `changed_files` while hiding a path the pull request changes.
	it.each([
		['a rename without its source', [{ filename: 'docs/relocated.ts', status: 'renamed' }]],
		['a copy without its source', [{ filename: 'docs/copied.ts', status: 'copied' }]],
		['a repeated entry', [entry('README.md'), entry('README.md')]],
		['an undocumented status', [{ filename: 'README.md', status: 'moved' }]]
	])('runs on %s', (_label, files) => {
		expect(pullRequest([files])).toEqual({
			run: true,
			reason: 'the changed-file list is malformed.'
		});
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
