import { rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	APP_TYPES,
	CLI_KNIP,
	CLI_TYPES,
	KNIP,
	cliKnipInvocations,
	knipInvocations,
	knipSuite,
	readCommandLog,
	runChecker,
	type CheckerClone
} from './__fixtures__/static-checks/knip-harness';

const suite = knipSuite();
const { createCheckerClone } = suite;

beforeAll(() => {
	suite.setUp();
}, 120_000);

afterAll(() => suite.tearDown());

describe('Knip static-check CLI behavior', { concurrent: false }, () => {
	it.each([
		['a double-quoted invocation', 'bun run "test:cli"'],
		['a single-quoted invocation', "bun run 'test:cli'"],
		['a shorthand invocation', 'bun test:cli'],
		['a split-quoted suffix', 'bun run test:"cli"'],
		['a split-quoted prefix', 'bun run "test":cli'],
		['an escaped separator', 'bun run test\\:cli'],
		['a split-quoted child directory', 'bun run --cwd packages/"create-saas-starter" build'],
		['a split-quoted child suffix', 'bun run --cwd packages/create-saas-"starter" build']
	])(
		'rejects a removed creator still referenced by %s before command dispatch',
		(_label, command) => {
			const checkout = createCheckerClone('absent', { scripts: { 'retry-cli': command } });
			try {
				const result = runChecker(checkout, ['--ci', '--scope', 'types']);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('Inconsistent creator package');
				expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toEqual([]);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

	it.each(['test:cli:app', 'test:cli-app'])(
		'keeps a removed creator absent beside the distinct custom script %s',
		(name) => {
			const checkout = createCheckerClone('absent', {
				scripts: { [name]: 'echo app', custom: `bun run ${name}` }
			});
			try {
				const result = runChecker(checkout, ['--ci', '--scope', 'types']);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(0);
				expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).not.toContainEqual(
					CLI_TYPES
				);
				expect(output).toContain('cli-types        skipped — creator package removed by setup');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

	it.each([
		'curl https://example.invalid/?label=test:cli',
		'FOO=test:cli bun scripts/app-task.ts',
		'bun run --cwd packages/create-saas-starter+docs build',
		'echo test:cli',
		'printf test:cli'
	])(
		'keeps a removed creator absent beside the unrelated command %s',
		(command) => {
			const checkout = createCheckerClone('absent', { scripts: { custom: command } });
			try {
				const result = runChecker(checkout, ['--ci', '--scope', 'types']);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(0);
				expect(output).toContain('cli-types        skipped — creator package removed by setup');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

	it.each([
		['null', '{"name":"create-saas-starter","scripts":null}\n'],
		['an array', '{"name":"create-saas-starter","scripts":[]}\n'],
		['a non-string command', '{"name":"create-saas-starter","scripts":{"knip":1}}\n']
	])(
		'rejects child scripts that are %s before command dispatch',
		(_label, childManifest) => {
			const checkout = createCheckerClone('present', { childManifest });
			try {
				const result = runChecker(checkout, ['--ci', '--scope', 'types']);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('child package.json is malformed');
				expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toEqual([]);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

	it('propagates a create-saas-starter Knip failure', () => {
		const checkout = createCheckerClone();
		checkout.env.STATIC_CHECKS_COMMAND_RESPONSE = JSON.stringify({ ...CLI_KNIP, status: 24 });
		try {
			const result = runChecker(checkout, ['--ci', '--scope', 'lint']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(24);
			expect(knipInvocations(checkout)).toEqual([KNIP]);
			expect(cliKnipInvocations(checkout)).toEqual([CLI_KNIP]);
			expect(output).toContain(
				'Command failed: bun run --cwd packages/create-saas-starter knip --no-progress'
			);
			expect(output).not.toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);
});

// Every recorded type check below exits 0, which is what the real svelte-check does for a
// standalone script: its tsconfig never reads the file, so it cannot report the error in it.
// Only the checker's own question to TypeScript can tell the named file was not checked (#929).
describe('type project coverage of named files', { concurrent: false }, () => {
	const STANDALONE = 'scripts/type-coverage-probe.ts';
	const COVERED = 'src/lib/billing/checkout-result.ts';

	function writeStandaloneScript(checkout: CheckerClone): void {
		writeFileSync(
			path.join(checkout.repository, STANDALONE),
			"export const count: number = 'wrong';\n"
		);
	}

	it.each([
		['alone', [STANDALONE]],
		['beside a covered file', [STANDALONE, COVERED]]
	] as const)(
		'fails a types run naming a standalone script %s',
		(_label, files) => {
			const checkout = createCheckerClone();
			try {
				writeStandaloneScript(checkout);
				const result = runChecker(checkout, ['--ci', '--scope', 'types', ...files]);
				const output = `${result.stdout}${result.stderr}`;

				expect(result.status, output).toBe(1);
				expect(output).toContain(
					`1 named source file(s) are read by no type-checked TypeScript project: "${STANDALONE}"`
				);
				expect(output).not.toContain('All checks passed!');
				expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).not.toContainEqual(
					APP_TYPES
				);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

	// No type route claims a .mts file, so only the coverage question can see it: beside a
	// routed file, svelte-check starts and the run would otherwise pass.
	it('fails a types run naming a module no route claims beside a covered file', () => {
		const checkout = createCheckerClone();
		const module = 'src/lib/type-coverage-probe.mts';
		try {
			writeFileSync(
				path.join(checkout.repository, module),
				"export const count: number = 'wrong';\n"
			);
			const result = runChecker(checkout, ['--ci', '--scope', 'types', module, COVERED]);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(1);
			expect(output).toContain(
				`1 named source file(s) are read by no type-checked TypeScript project: "${module}"`
			);
			expect(output).not.toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it('passes a types run naming only a file the app project includes', () => {
		const checkout = createCheckerClone();
		try {
			const result = runChecker(checkout, ['--ci', '--scope', 'types', COVERED]);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toContainEqual(APP_TYPES);
			expect(output).toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	// svelte-check reports errors in every module its project imports, not only in the files
	// its tsconfig includes: vite.config.ts pulls scripts/dev-ports.ts into the app program.
	it('passes a types run naming a script that a project file imports', () => {
		const checkout = createCheckerClone();
		try {
			writeStandaloneScript(checkout);
			writeFileSync(
				path.join(checkout.repository, 'src/lib/type-coverage-importer.ts'),
				"export { count } from '../../scripts/type-coverage-probe';\n"
			);
			const result = runChecker(checkout, ['--ci', '--scope', 'types', STANDALONE]);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toContainEqual(APP_TYPES);
			expect(output).toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	// The checker names a link by its target, while TypeScript lists the link under its own
	// name when the project includes it. Creating a file link needs privileges on Windows.
	it.skipIf(process.platform === 'win32')(
		'passes a types run naming a link the app project includes',
		() => {
			const checkout = createCheckerClone();
			const link = 'src/lib/type-coverage-link.ts';
			try {
				writeStandaloneScript(checkout);
				symlinkSync('../../scripts/type-coverage-probe.ts', path.join(checkout.repository, link));
				const result = runChecker(checkout, ['--ci', '--scope', 'types', link]);
				const output = `${result.stdout}${result.stderr}`;

				expect(result.status, output).toBe(0);
				expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toContainEqual(APP_TYPES);
				expect(output).toContain('All checks passed!');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);
});
