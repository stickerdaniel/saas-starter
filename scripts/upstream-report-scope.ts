/**
 * Decides whether the Upstream Report Tests job runs the detector suite.
 *
 * The suite takes minutes and almost no pull request touches what it reads, but its check
 * is required, so the job always starts and reports; only its test steps depend on this
 * selection. Anything other than a pull request runs them, and so does a pull request
 * whose complete changed-file list cannot be read. The repository variable
 * `CI_FULL_SUITE=true` runs them everywhere, to switch the selection off without a commit.
 *
 * The job runs `bun scripts/upstream-report-scope.ts` before installing dependencies, so
 * this file imports Node built-ins only. It reads FULL_SUITE, EVENT_NAME, PR_NUMBER, CHANGED_FILES,
 * GITHUB_REPOSITORY and GH_TOKEN, and appends `run=true|false` to GITHUB_OUTPUT.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/**
 * Repository paths the suite imports, reads, or is installed and configured from. A
 * trailing slash covers a directory. `upstream-report-scope.test.ts` fails when the suite or
 * this selection reaches a repository path outside this list, or reads or loads a path it
 * cannot resolve.
 */
export const UPSTREAM_REPORT_TEST_INPUTS = [
	// The detector, its tests, and the suite's Vitest config.
	'.agents/skills/upstream-report/',
	// The toolchain and dependencies; one test also reads the package scripts.
	'package.json',
	'bun.lock',
	'bunfig.toml',
	'.npmrc',
	'patches/',
	// Loaded by the suite's Vitest config and its tests.
	'scripts/vitest-settings.ts',
	'tsconfig.tooling.json',
	// The job itself, which one test also reads, and the selection it runs.
	'.github/workflows/static-checks.yml',
	'scripts/upstream-report-scope.ts',
	// Line endings of every input on checkout.
	'.gitattributes'
] as const;

export function isUpstreamReportTestInput(path: string): boolean {
	return UPSTREAM_REPORT_TEST_INPUTS.some((input) =>
		input.endsWith('/') ? path.startsWith(input) : path === input
	);
}

export interface Selection {
	run: boolean;
	reason: string;
}

export interface SelectionInput {
	/** The `CI_FULL_SUITE` repository variable. */
	fullSuite?: string | undefined;
	eventName: string | undefined;
	/** `pull_request.changed_files` from the event payload. */
	changedFiles: string | undefined;
	/** The pages `gh api --paginate --slurp` printed for the pull request's files. */
	readPages: () => unknown;
}

/** The `status` values GitHub documents for a pull request's files. */
const FILE_STATUSES = new Set([
	'added',
	'removed',
	'modified',
	'renamed',
	'copied',
	'changed',
	'unchanged'
]);

/**
 * Every path a pull request touches, both sides of a rename or copy included, or
 * `undefined` when the pages are not the shape GitHub returns. `count` is the number of
 * file entries, which GitHub's `changed_files` must equal for the list to be complete.
 * That comparison only proves completeness when every entry names a distinct file and
 * both of its sides, so an undocumented status, a repeated path, or a rename or copy
 * without its source makes the list malformed.
 */
function changedPaths(pages: unknown): { count: number; paths: string[] } | undefined {
	if (!Array.isArray(pages) || !pages.every(Array.isArray)) return undefined;
	const entries: unknown[] = pages.flat();
	const paths: string[] = [];
	const filenames = new Set<string>();
	for (const entry of entries) {
		if (typeof entry !== 'object' || entry === null) return undefined;
		const { filename, status, previous_filename: previous } = entry as Record<string, unknown>;
		if (typeof filename !== 'string' || filename.length === 0 || filenames.has(filename)) {
			return undefined;
		}
		if (typeof status !== 'string' || !FILE_STATUSES.has(status)) return undefined;
		filenames.add(filename);
		paths.push(filename);
		if (previous === undefined && status !== 'renamed' && status !== 'copied') continue;
		if (typeof previous !== 'string' || previous.length === 0) return undefined;
		paths.push(previous);
	}
	return { count: entries.length, paths };
}

export function selectUpstreamReportTests({
	fullSuite,
	eventName,
	changedFiles,
	readPages
}: SelectionInput): Selection {
	const run = (reason: string): Selection => ({ run: true, reason });

	if (fullSuite === 'true') return run('CI_FULL_SUITE is set.');
	if (eventName !== 'pull_request') {
		return run(`a ${eventName ?? 'missing'} event always runs the suite.`);
	}
	if (changedFiles === undefined || !/^(?:0|[1-9]\d*)$/.test(changedFiles)) {
		return run('the event carries no changed-file count.');
	}

	let pages: unknown;
	try {
		pages = readPages();
	} catch (error) {
		return run(`the changed files could not be read: ${(error as Error).message}`);
	}
	const changed = changedPaths(pages);
	if (!changed) return run('the changed-file list is malformed.');
	// GitHub lists at most 3000 files, so a larger pull request lands here as well.
	if (changed.count !== Number(changedFiles)) {
		return run(`the changed-file list has ${changed.count} of ${changedFiles} entries.`);
	}

	const input = changed.paths.find(isUpstreamReportTestInput);
	return input
		? run(`${input} is an input of the suite.`)
		: {
				run: false,
				reason: `none of the ${changed.count} changed files is an input of the suite.`
			};
}

function readPullRequestFiles(): unknown {
	const repository = process.env.GITHUB_REPOSITORY;
	const number = process.env.PR_NUMBER;
	if (!repository || !/^[1-9]\d*$/.test(number ?? '')) {
		throw new Error('the pull request identity is missing');
	}
	const output = execFileSync(
		'gh',
		['api', '--paginate', '--slurp', `repos/${repository}/pulls/${number}/files`],
		{ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }
	);
	return JSON.parse(output);
}

if (import.meta.main) {
	const selection = selectUpstreamReportTests({
		fullSuite: process.env.FULL_SUITE,
		eventName: process.env.EVENT_NAME,
		changedFiles: process.env.CHANGED_FILES,
		readPages: readPullRequestFiles
	});
	console.log(
		`${selection.run ? 'Running' : 'Skipping'} the upstream report tests: ${selection.reason}`
	);
	// The job runs the tests unless this reads `false`, so a missing output fails closed.
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `run=${selection.run}\n`);
}
