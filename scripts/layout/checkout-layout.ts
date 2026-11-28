import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readText, StaleInput, treeFiles, type Run } from './run.ts';

const FIXTURE = 'scripts/__fixtures__/static-checks/workspace-layout.ts';
const PRODUCTION = 'scripts/workspace-check-layout.ts';
const PARITY_CASES = [
	'gives every tracked path on its moved path exactly the checks it has today',
	'gives a new file on its moved path exactly the checks it gets on the flat tree'
];
const BINDING = 'const CHECKOUT_LAYOUT: CheckLayout = WORKSPACE_CHECK_LAYOUT;';
const IMPORT = "import { WORKSPACE_CHECK_LAYOUT } from './workspace-check-layout';";

interface AssertionResult {
	readonly title: string;
	readonly status: string;
	readonly failureMessages: readonly string[];
}

export function parityProblems(checkout: string): string[] {
	const scratch = mkdtempSync(join(tmpdir(), 'layout-parity-'));
	const reportPath = join(scratch, 'report.json');
	try {
		const result = spawnSync(
			process.execPath,
			[
				'x',
				'vitest',
				'--config',
				'vitest.tooling.config.ts',
				'--run',
				'--reporter=json',
				`--outputFile.json=${reportPath}`,
				'scripts/static-checks.test.ts',
				'--testNamePattern',
				PARITY_CASES.join('|')
			],
			{ cwd: checkout, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
		);
		if (!existsSync(reportPath)) {
			return [`The parity suite wrote no report: ${result.stderr.trim()}`];
		}
		const report: { testResults: Array<{ assertionResults: AssertionResult[] }> } = JSON.parse(
			readFileSync(reportPath, 'utf8')
		);
		const cases = report.testResults
			.flatMap(({ assertionResults }) => assertionResults)
			.filter(({ title }) => PARITY_CASES.includes(title));
		if (cases.length !== PARITY_CASES.length) {
			return [`The parity suite ran ${cases.length} of its ${PARITY_CASES.length} cases`];
		}
		return cases
			.filter(({ status }) => status !== 'passed')
			.flatMap(({ title, failureMessages }) => [`${title}:`, ...failureMessages]);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

export function layoutDifferences(
	expected: unknown,
	actual: unknown,
	paths: readonly string[],
	at = 'WORKSPACE_CHECK_LAYOUT'
): string[] {
	if (typeof expected === 'function' && typeof actual === 'function') {
		const [before, after] = [expected, actual] as Array<(path: string) => unknown>;
		const differing = paths.filter(
			(path) => JSON.stringify(before!(path)) !== JSON.stringify(after!(path))
		);
		return differing.length ? [`${at} differs for ${differing.slice(0, 3).join(', ')}`] : [];
	}
	if (expected instanceof RegExp || actual instanceof RegExp) {
		return String(expected) === String(actual) ? [] : [`${at} is ${String(actual)}`];
	}
	if (typeof expected === 'object' && typeof actual === 'object' && expected && actual) {
		const record = (value: object) => value as Record<string, unknown>;
		const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
		return [...keys].flatMap((key) =>
			layoutDifferences(record(expected)[key], record(actual)[key], paths, `${at}.${key}`)
		);
	}
	return Object.is(expected, actual) ? [] : [`${at} is ${JSON.stringify(actual)}`];
}

const sourceLayouts = new WeakMap<Run, unknown>();

const layoutOf = async (path: string): Promise<unknown> =>
	(await import(pathToFileURL(path).href)).WORKSPACE_CHECK_LAYOUT;

export async function verifyCheckoutLayout(run: Run): Promise<void> {
	if (!run.inputs.repositoryChecks) return;
	const problems = parityProblems(run.checkout);
	if (problems.length) {
		throw new StaleInput(`The parity suite of the source commit fails:\n${problems.join('\n')}`);
	}
	sourceLayouts.set(run, await layoutOf(join(run.checkout, FIXTURE)));
}

export async function checkCheckoutLayout(run: Run): Promise<void> {
	if (!run.inputs.repositoryChecks) return;
	const checker = readText(run, 'scripts/static-checks.ts');
	const missing = [IMPORT, BINDING].filter((line) => !checker.includes(line));
	const differences = layoutDifferences(
		sourceLayouts.get(run),
		await layoutOf(join(run.checkout, PRODUCTION)),
		treeFiles(run)
	);
	const problems = [
		...missing.map((line) => `scripts/static-checks.ts lacks ${line}`),
		...differences
	];
	if (problems.length) {
		throw new StaleInput(`The checker does not read the compared layout:\n${problems.join('\n')}`);
	}
}
