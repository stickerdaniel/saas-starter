import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { runsWhen } from './github-expression';
import {
	UPSTREAM_REPORT_TEST_INPUTS,
	isUpstreamReportTestInput,
	selectUpstreamReportTests
} from './upstream-report-scope';

const ROOT = path.resolve(import.meta.dirname, '..');

interface Step {
	id?: string;
	if?: string;
	uses?: string;
	run?: string;
	env?: Record<string, unknown>;
	with?: Record<string, unknown>;
}

const steps =
	(
		parseYaml(readFileSync(path.join(ROOT, '.github/workflows/static-checks.yml'), 'utf8')) as {
			jobs: Record<string, { steps?: Step[] } | undefined>;
		}
	).jobs['upstream-report-tests']?.steps ?? [];

const checkouts = steps.filter((step) => step.uses?.startsWith('actions/checkout@'));

/** The one checkout step that runs for an event while `CI_FULL_SUITE` has the given value. */
function checkoutFor(eventName: string, fullSuite: string): Step | undefined {
	const contexts = { github: { event_name: eventName }, vars: { CI_FULL_SUITE: fullSuite } };
	const running = checkouts.filter((step) =>
		runsWhen(step.if, contexts, { success: true, failure: false, cancelled: false })
	);
	expect(running, `${eventName} with CI_FULL_SUITE=${fullSuite}`).toHaveLength(1);
	return running[0];
}

describe('upstream report test inputs', () => {
	it('checks out exactly the inputs on a pull request', () => {
		const options = checkoutFor('pull_request', '')?.with ?? {};
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

	// A test that tolerates a missing file passes on the sparse checkout without it, so only a
	// run on the full tree shows an input the list does not declare.
	it.each([
		['push', ''],
		['workflow_dispatch', ''],
		['merge_group', ''],
		['schedule', ''],
		['pull_request', 'true']
	])('checks out the full tree on %s with CI_FULL_SUITE=%j', (eventName, fullSuite) => {
		const options = checkoutFor(eventName, fullSuite)?.with ?? {};
		expect(options['sparse-checkout']).toBeUndefined();
	});

	it('checks out the selection it runs', () => {
		const command = steps.find((step) => step.id === 'scope')?.run?.trim() ?? '';
		const script = /^bun (\S+)$/.exec(command)?.[1];
		expect(script, command).toBeDefined();
		expect(isUpstreamReportTestInput(script ?? ''), script).toBe(true);
	});

	// A blob outside the checkout is still promised by the blobless clone; with lazy fetching
	// a test could read it through Git and keep passing when that file changes.
	it('blocks lazy object fetches wherever the suite installs or runs', () => {
		// Commands only: the gated cache restore runs no Git command.
		const gated = steps.filter(
			(step) => step.if?.includes('steps.scope.outputs.run') && step.run !== undefined
		);
		expect(gated.map((step) => step.run?.trim())).toEqual([
			'bun install --frozen-lockfile --ignore-scripts',
			'bun run test:upstream-report'
		]);
		for (const step of gated) expect(step.env?.GIT_NO_LAZY_FETCH, step.run).toBe('1');
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
	const HEAD = 'a'.repeat(40);
	const BASE = 'c'.repeat(40);
	const event = {
		eventName: 'pull_request',
		headSha: HEAD,
		baseSha: BASE,
		repository: 'example/fixture'
	};
	const comparison = (files: unknown) => ({ status: 'ahead', files });
	const pullRequest = (files: unknown[], changedFiles = String(files.length)) =>
		selectUpstreamReportTests({
			...event,
			changedFiles,
			readApi: () => comparison(files)
		});

	it('skips a pull request that changes only documentation', () => {
		expect(pullRequest([entry('README.md'), entry('docs/AGENTS.md')]).run).toBe(false);
	});

	it.each([
		'.agents/skills/upstream-report/SKILL.md',
		'bun.lock',
		'.github/workflows/static-checks.yml'
	])('runs when a pull request changes %s', (file) => {
		expect(pullRequest([entry('README.md'), entry(file)]).run).toBe(true);
	});

	it('runs when a pull request changes only an attributes file below the root', () => {
		expect(pullRequest([entry('.agents/.gitattributes')]).run).toBe(true);
	});

	it('runs when a rename moves an input out of scope', () => {
		const rename = entry(
			'docs/upstream-relevance.ts',
			'.agents/skills/upstream-report/scripts/upstream-relevance.ts'
		);
		expect(pullRequest([rename]).run).toBe(true);
	});

	it('runs when the file list is incomplete', () => {
		expect(pullRequest([entry('README.md')], '2').run).toBe(true);
	});

	// GitHub stops a comparison at 300 files without saying so.
	it('runs when the file list may have stopped at the comparison limit', () => {
		const files = Array.from({ length: 300 }, (_, index) => entry(`docs/${index}.md`));
		expect(pullRequest(files).run).toBe(true);
		expect(pullRequest(files.slice(1)).run).toBe(false);
	});

	// Each of these matches `changed_files` while hiding a path the pull request changes.
	it.each([
		['a rename without its source', [{ filename: 'docs/relocated.ts', status: 'renamed' }]],
		['a copy without its source', [{ filename: 'docs/copied.ts', status: 'copied' }]],
		['a repeated entry', [entry('README.md'), entry('README.md')]],
		['an undocumented status', [{ filename: 'README.md', status: 'moved' }]]
	])('runs on %s', (_label, files) => {
		expect(pullRequest(files)).toEqual({
			run: true,
			reason: 'the changed-file list is malformed.'
		});
	});

	// A missing list must not pass for an empty one.
	it.each([
		[
			'an unreadable comparison',
			() => {
				throw new Error('HTTP 502');
			}
		],
		['a comparison without files', () => ({ status: 'identical' })],
		['a file list that is not a list', () => comparison({})]
	])('runs on %s', (_label, readApi) => {
		expect(selectUpstreamReportTests({ ...event, changedFiles: '0', readApi }).run).toBe(true);
	});

	it('runs on an entry without a path', () => {
		expect(pullRequest([{ status: 'modified' }]).run).toBe(true);
	});

	it('runs when the event carries no changed-file count', () => {
		expect(pullRequest([entry('README.md')], '').run).toBe(true);
	});

	// The pull request's own file list follows its head as it moves; only a comparison of
	// the event's two commits describes exactly this event.
	it("compares the event's base and head commits", () => {
		const readApi = vi.fn(() => comparison([entry('README.md')]));
		expect(selectUpstreamReportTests({ ...event, changedFiles: '1', readApi }).run).toBe(false);
		expect(readApi.mock.calls).toEqual([
			[`repos/example/fixture/compare/${BASE}...${HEAD}?per_page=1`]
		]);
	});

	it.each([
		['no head commit', { headSha: undefined }],
		['no base commit', { baseSha: '' }],
		['a head that is no commit', { headSha: 'main' }],
		['no repository', { repository: undefined }]
	])('runs when the event carries %s', (_label, missing) => {
		const readApi = vi.fn(() => comparison([entry('README.md')]));
		expect(
			selectUpstreamReportTests({ ...event, ...missing, changedFiles: '1', readApi }).run
		).toBe(true);
		expect(readApi).not.toHaveBeenCalled();
	});

	it.each(['push', 'workflow_dispatch', 'merge_group'])(
		'runs on %s whatever changed',
		(eventName) => {
			const readApi = vi.fn(() => comparison([entry('README.md')]));
			expect(
				selectUpstreamReportTests({ ...event, eventName, changedFiles: '1', readApi }).run
			).toBe(true);
			expect(readApi).not.toHaveBeenCalled();
		}
	);

	it('runs on a docs-only pull request while CI_FULL_SUITE is set', () => {
		const readApi = () => comparison([entry('README.md')]);
		const select = (fullSuite: string) =>
			selectUpstreamReportTests({
				...event,
				fullSuite,
				changedFiles: '1',
				readApi
			}).run;
		expect(select('')).toBe(false);
		expect(select('true')).toBe(true);
		expect(select('TRUE')).toBe(true);
		expect(select('True')).toBe(true);
		expect(select('yes')).toBe(false);
	});
});
