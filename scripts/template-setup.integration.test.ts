/**
 * Runs the real setup process against private fixture copies. Full processes prove
 * generated branding remains importable and rejected inputs fail before mutation.
 * Fixtures need no installed dependencies because setup imports only built-ins and
 * dependency-free local modules.
 */
import { spawnSync } from 'node:child_process';
import {
	accessSync,
	chmodSync,
	constants,
	cpSync,
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { testExecutable } from './test-executable';

const ROOT = join(import.meta.dirname, '..');
/** Real Bun executable resolved before tests; the test runner itself uses Node. */
const BUN = testExecutable('bun');
const CHILD_ENV: NodeJS.ProcessEnv = Object.fromEntries(
	[
		'PATH',
		'HOME',
		'TMPDIR',
		'TEMP',
		'TMP',
		'SystemRoot',
		'ComSpec',
		'PATHEXT',
		'USERPROFILE'
	].flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]]))
);

const FIXTURE_FILES = [
	'package.json',
	'bun.lock',
	'README.md',
	'wrangler.toml',
	'scripts/template-setup.ts',
	'src/lib/config/legal.ts',
	'src/lib/config/site.ts',
	'src/lib/content/legal-metadata.ts'
] as const;

const fixtures: string[] = [];

afterAll(() => {
	for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function createFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), 'template-setup-'));
	fixtures.push(dir);
	for (const rel of FIXTURE_FILES) {
		const dest = join(dir, rel);
		mkdirSync(dirname(dest), { recursive: true });
		cpSync(join(ROOT, rel), dest);
	}
	return dir;
}

function snapshot(dir: string): Record<string, string> {
	return Object.fromEntries(
		FIXTURE_FILES.map((rel) => [rel, readFileSync(join(dir, rel), 'utf-8')])
	);
}

function runSetup(dir: string, args: string[], preload?: string) {
	// Use the public manifest dispatch so preload faults exercise the same process path as users.
	const command = preload
		? [`--preload=${preload}`, 'run', 'setup', ...args]
		: ['run', 'setup', ...args];
	const result = spawnSync(BUN, command, {
		cwd: dir,
		encoding: 'utf-8',
		// The manifest script starts a nested Bun runtime; propagate the same CLI preload to it.
		env: preload
			? { ...CHILD_ENV, BUN_OPTIONS: `--preload=${preload.replaceAll('\\', '/')}` }
			: CHILD_ENV,
		// Keep stdin detached from a TTY, matching CI and non-interactive CLI use.
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 60_000,
		killSignal: 'SIGKILL'
	});
	return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

type FaultPhase =
	| 'write'
	| 'partial-write'
	| 'chmod'
	| 'single-install'
	| 'single-cleanup-rmdir'
	| 'legal-backup'
	| 'legal-config-install'
	| 'legal-metadata-install'
	| 'legal-metadata-and-restore'
	| 'legal-cleanup-unlink'
	| 'legal-cleanup-rmdir';

let faultSequence = 0;

function createFaultPreload(
	dir: string,
	spec: { phase: FaultPhase; target: (typeof FIXTURE_FILES)[number] }
): { id: string; path: string } {
	faultSequence += 1;
	const id = `SETUP_FAULT_${faultSequence}_${spec.phase.replaceAll('-', '_').toUpperCase()}`;
	const preload = join(dir, `fault-${faultSequence}.mjs`);
	const source = `import { mock } from 'bun:test';
import defaultFs, * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const id = ${JSON.stringify(id)};
const phase = ${JSON.stringify(spec.phase)};
const target = ${JSON.stringify(spec.target)};
const targetSuffix = '/' + target;
const targetBasename = target.slice(target.lastIndexOf('/') + 1);
const targetParent = target.slice(0, target.lastIndexOf('/'));
const prefix = Buffer.from('SETUP_PARTIAL_PREFIX');
const normalize = (value) => String(value).replaceAll('\\\\', '/');
const isStage = (value) => normalize(value).includes('/.template-setup-');
const realWriteFileSync = fs.writeFileSync;
const realReadFileSync = fs.readFileSync;
const realChmodSync = fs.chmodSync;
const realRenameSync = fs.renameSync;
const realUnlinkSync = fs.unlinkSync;
const realRmdirSync = fs.rmdirSync;
let metadataFaulted = false;

function fail(operation, detail) {
	console.error('FAULT_HIT ' + id + ' operation=' + operation + ' ' + detail);
	const error = new Error(id + ' injected ' + operation);
	error.code = 'EIO';
	throw error;
}

const replacements = {
	writeFileSync(path, data, options) {
		const normalized = normalize(path);
		if ((phase === 'write' || phase === 'partial-write') && normalized.endsWith('/' + targetBasename)) {
			const flag = typeof options === 'object' && options ? options.flag : undefined;
			if (phase === 'partial-write') {
				realWriteFileSync(path, prefix, options);
				const observed = realReadFileSync(path);
				fail('writeFileSync', 'path=' + normalized + ' stage=' + isStage(path) + ' flag=' + flag + ' prefix=' + observed.equals(prefix));
			}
			fail('writeFileSync', 'path=' + normalized + ' stage=' + isStage(path) + ' flag=' + flag);
		}
		return realWriteFileSync(path, data, options);
	},
	chmodSync(path, mode) {
		const normalized = normalize(path);
		if (phase === 'chmod' && normalized.endsWith('/' + targetBasename)) {
			fail('chmodSync', 'path=' + normalized + ' stage=' + isStage(path) + ' mode=' + mode.toString(8));
		}
		return realChmodSync(path, mode);
	},
	renameSync(from, to) {
		const source = normalize(from);
		const destination = normalize(to);
		const singleInstall =
			phase === 'single-install' &&
			isStage(source) &&
			source.endsWith('/' + targetBasename) &&
			destination.endsWith(targetSuffix);
		const legalBackup =
			phase === 'legal-backup' &&
			source.endsWith('/src/lib/config/legal.ts') &&
			isStage(destination) &&
			destination.endsWith('/legal.ts.backup');
		const legalConfigInstall =
			phase === 'legal-config-install' &&
			isStage(source) &&
			source.endsWith('/legal.ts') &&
			destination.endsWith('/src/lib/config/legal.ts');
		const legalMetadataInstall =
			(phase === 'legal-metadata-install' || phase === 'legal-metadata-and-restore') &&
			isStage(source) &&
			source.endsWith('/legal-metadata.ts') &&
			destination.endsWith('/src/lib/content/legal-metadata.ts');
		const legalRestore =
			phase === 'legal-metadata-and-restore' &&
			metadataFaulted &&
			source.endsWith('/legal.ts.backup') &&
			destination.endsWith('/src/lib/config/legal.ts');
		if (singleInstall || legalBackup || legalConfigInstall) {
			fail('renameSync', 'from=' + source + ' to=' + destination);
		}
		if (legalMetadataInstall) {
			metadataFaulted = true;
			fail('renameSync', 'from=' + source + ' to=' + destination);
		}
		if (legalRestore) {
			fail('renameSync-restore', 'from=' + source + ' to=' + destination);
		}
		return realRenameSync(from, to);
	},
	unlinkSync(path) {
		const normalized = normalize(path);
		if (phase === 'legal-cleanup-unlink' && normalized.endsWith('/legal.ts.backup')) {
			fail('unlinkSync', 'path=' + normalized + ' stage=' + isStage(path));
		}
		return realUnlinkSync(path);
	},
	rmdirSync(path) {
		const normalized = normalize(path);
		if (
			(phase === 'legal-cleanup-rmdir' || phase === 'single-cleanup-rmdir') &&
			isStage(path) &&
			normalized.includes('/' + targetParent + '/.template-setup-' + targetBasename + '-')
		) {
			fail('rmdirSync', 'path=' + normalized + ' stage=true');
		}
		return realRmdirSync(path);
	}
};
Object.assign(defaultFs, replacements);
syncBuiltinESMExports();
mock.module('fs', () => ({ ...fs, ...replacements }));
`;
	writeFileSync(preload, source, 'utf-8');
	return { id, path: preload };
}

function expectFault(
	run: ReturnType<typeof runSetup>,
	fault: { id: string },
	operation: string
): void {
	expect(run.code).toBe(1);
	expect(run.stderr).toContain(`FAULT_HIT ${fault.id} operation=${operation}`);
	expect(run.stderr).toContain('template-setup.ts');
}

function stagingArtifacts(dir: string): string[] {
	const found: string[] = [];
	function visit(current: string): void {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.name.startsWith('.template-setup-')) found.push(path);
			if (entry.isDirectory()) visit(path);
		}
	}
	visit(dir);
	return found;
}

function mode(dir: string, rel: (typeof FIXTURE_FILES)[number]): number {
	return lstatSync(join(dir, rel)).mode & 0o7777;
}

/** Imports the generated legal.ts in a fresh process. */
function importLegalConfig(dir: string) {
	const importer = join(dir, 'import-legal.ts');
	writeFileSync(
		importer,
		"import { LEGAL_CONFIG, getLegalEmailAddress } from './src/lib/config/legal';\n" +
			'console.log(JSON.stringify({ config: LEGAL_CONFIG, mailto: getLegalEmailAddress() }));\n',
		'utf-8'
	);
	const result = spawnSync(BUN, [importer], {
		cwd: dir,
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 60_000,
		killSignal: 'SIGKILL'
	});
	return {
		code: result.status ?? -1,
		stderr: result.stderr ?? '',
		value:
			result.status === 0
				? (JSON.parse(result.stdout) as { config: Record<string, unknown>; mailto: string })
				: undefined
	};
}

const IDENTITY = [
	'--brand',
	'Northwind Labs',
	'--company',
	'Northwind Labs GmbH',
	'--operator',
	'Anne Weber',
	'--address',
	'Hauptstrasse 5, 12345 Berlin',
	'--email',
	'kontakt@northwind-labs.de'
];

const REQUIRED = ['--slug', 'northwind-labs', '--repo', 'northwind/northwind-labs'];

function asciiDomainOfLength(length: number): string {
	const labels: string[] = [];
	let remaining = length;
	while (remaining > 63) {
		labels.push('a'.repeat(63));
		remaining -= 64;
	}
	labels.push('a'.repeat(remaining));
	return labels.join('.');
}

/** IDENTITY without brand and company so their defaults apply. */
const IDENTITY_WITHOUT_COMPANY = [
	'--operator',
	'Anne Weber',
	'--address',
	'Hauptstrasse 5, 12345 Berlin',
	'--email',
	'kontakt@northwind-labs.de'
];

describe('template setup writes importable branding values', () => {
	// Ordinary names are sufficient: an apostrophe used to break generated code.
	it.each([
		{ label: 'apostrophe', flag: '--brand', key: 'brandName', value: "O'Connor Software" },
		{
			label: 'double quotes',
			flag: '--company',
			key: 'companyName',
			value: 'The "Blue Door" GmbH'
		},
		{
			label: 'ampersand, apostrophe, and hyphen',
			flag: '--operator',
			key: 'operatorName',
			value: "Anne-Marie & O'Connor"
		},
		{
			label: 'literal entity text',
			flag: '--brand',
			key: 'brandName',
			value: 'Research &copy; Labs'
		},
		{
			label: 'parentheses and Unicode symbols',
			flag: '--brand',
			key: 'brandName',
			value: 'Northwind (Europe)™ 🚀'
		},
		{
			label: 'slash and at sign',
			flag: '--operator',
			key: 'operatorName',
			value: 'Research / Development @ Northwind'
		},
		{ label: 'backslash', flag: '--operator', key: 'operatorName', value: 'Anne\\Marie Weber' },
		{
			label: 'multiline address',
			flag: '--address',
			key: 'address',
			value: 'Hauptstrasse 5\n12345 Berlin\nDeutschland'
		},
		{
			// Replacement metacharacters must remain literal data.
			label: 'replacement metacharacters',
			flag: '--company',
			key: 'companyName',
			value: "Ampersand $& Backref $1 Tick $` Quote $' Co"
		}
	])('keeps a $label intact', ({ flag, key, value }) => {
		const dir = createFixture();
		const run = runSetup(dir, [...REQUIRED, ...IDENTITY, flag, value]);
		expect(run.code, run.stderr).toBe(0);

		const imported = importLegalConfig(dir);
		expect(imported.code, imported.stderr).toBe(0);
		expect(imported.value?.config[key]).toBe(value);
	});

	it('derives the contact email helpers from the supplied address', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);

		const imported = importLegalConfig(dir);
		expect(imported.code, imported.stderr).toBe(0);
		expect(imported.value?.mailto).toBe('kontakt@northwind-labs.de');
		expect(imported.value?.config.email).toEqual({
			user: 'kontakt',
			domain: 'northwind-labs',
			tld: 'de'
		});
	});
});

describe('template setup re-runs', () => {
	it('preserves the configured identity without identity flags', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
		const afterFirst = snapshot(dir);

		const rerun = runSetup(dir, REQUIRED);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(afterFirst);
	});

	it('preserves a literal single delimiter across a flagless re-run', () => {
		const dir = createFixture();
		const first = runSetup(dir, [...REQUIRED, ...IDENTITY, '--brand', 'A*STAR']);
		expect(first.code, first.stderr).toBe(0);
		const imported = importLegalConfig(dir);
		expect(imported.code, imported.stderr).toBe(0);
		expect(imported.value?.config.brandName).toBe('A*STAR');
		const afterFirst = snapshot(dir);

		const rerun = runSetup(dir, []);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(afterFirst);
	});

	it('keeps completion signals unset when legal.ts fails and rejects a flagless re-run', () => {
		const dir = createFixture();
		const preload = join(dir, 'fail-legal-write.mjs');
		writeFileSync(
			preload,
			`import { mock } from 'bun:test';
import * as fs from 'node:fs';

const realWriteFileSync = fs.writeFileSync;
mock.module('fs', () => ({
	...fs,
	writeFileSync(path, ...args) {
		const normalized = String(path).replaceAll('\\\\', '/');
		if (normalized.includes('/.template-setup-') && normalized.endsWith('/legal.ts')) {
			const error = new Error('Injected EIO for legal.ts');
			error.code = 'EIO';
			throw error;
		}
		return realWriteFileSync(path, ...args);
	}
}));
`,
			'utf-8'
		);
		const before = snapshot(dir);

		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], preload);
		expect(failed.code).toBe(1);
		expect(failed.stderr).toMatch(/Injected EIO for legal\.ts/);
		const partial = snapshot(dir);
		expect(partial).toEqual(before);

		const rerun = runSetup(dir, []);
		expect(rerun.code).toBe(1);
		expect(rerun.stderr).toMatch(/Missing: --slug, --repo, --brand/);
		expect(snapshot(dir)).toEqual(partial);
	});

	it('keeps a brand that was deliberately set to the template name', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY.slice(2), '--brand', 'SaaS Starter']).code).toBe(
			0
		);
		const afterFirst = snapshot(dir);

		// The explicitly chosen name takes precedence over titleCase('northwind-labs').
		const rerun = runSetup(dir, REQUIRED);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(afterFirst);
		expect(readFileSync(join(dir, 'src/lib/config/legal.ts'), 'utf-8')).toContain(
			"brandName: 'SaaS Starter'"
		);
	});

	it('rewrites the quick start again after the repository is renamed', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
		const renamed = runSetup(dir, [
			'--slug',
			'northwind-cloud',
			'--repo',
			'northwind/northwind-cloud'
		]);
		expect(renamed.code, renamed.stderr).toBe(0);

		const readme = readFileSync(join(dir, 'README.md'), 'utf-8');
		expect(readme).toContain('git clone https://github.com/northwind/northwind-cloud.git');
		expect(readme).toContain('cd ./northwind-cloud');
		expect(readme).not.toContain('northwind-labs');
	});
});

describe('template setup legal metadata anchors', () => {
	it('updates the three exported dates without matching a comment', () => {
		const dir = createFixture();
		const metadata = join(dir, 'src/lib/content/legal-metadata.ts');
		writeFileSync(
			metadata,
			readFileSync(metadata, 'utf-8').replace(
				"\timpressum: '2026-03-21'",
				'\t// impressum: \'2000-01-01\'\n\timpressum: "2026-03-21"'
			),
			'utf-8'
		);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const updated = readFileSync(metadata, 'utf-8');
		expect(updated).toContain("// impressum: '2000-01-01'");
		const dates = [...updated.matchAll(/^\s*(privacy|terms|impressum): ['"]([^'"]+)['"]/gm)].map(
			([, , date]) => date
		);
		expect(dates).toHaveLength(3);
		expect(new Set(dates).size).toBe(1);
		expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('rejects a flagless re-run with a missing exported date before writes', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
		const metadata = join(dir, 'src/lib/content/legal-metadata.ts');
		writeFileSync(
			metadata,
			readFileSync(metadata, 'utf-8').replace(/^\s*impressum: ['"][^'"]+['"]\r?\n/m, ''),
			'utf-8'
		);
		const before = snapshot(dir);

		const rerun = runSetup(dir, []);
		expect(rerun.code).toBe(1);
		expect(rerun.stderr).toMatch(/Could not update every date/);
		expect(snapshot(dir)).toEqual(before);
	});
});

describe('template setup quick start', () => {
	it('replaces the template instructions with the generated project setup', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);

		const readme = readFileSync(join(dir, 'README.md'), 'utf-8');
		expect(readme.split('\n')[0]).toBe('# Northwind Labs');
		expect(readme).toContain(
			'```bash\ngit clone https://github.com/northwind/northwind-labs.git\ncd ./northwind-labs\nbun install\nbun run dev\n```'
		);
		expect(readme).not.toContain('gh repo create');
		expect(readme).not.toContain('my-saas-product');
		expect(readme).not.toContain('Live demo!');
		// Unrelated prose remains unchanged.
		expect(readme).toContain('## Why This Exists');
	});

	it('keeps links to prefix-related repositories byte-identical', () => {
		const dir = createFixture();
		const readme = join(dir, 'README.md');
		const relatedLink = 'https://github.com/stickerdaniel/saas-starter-tools/issues/1';
		writeFileSync(readme, `${readFileSync(readme, 'utf-8')}\n${relatedLink}\n`, 'utf-8');

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const updated = readFileSync(readme, 'utf-8');
		expect(updated).toContain(relatedLink);
		expect(updated).toContain('https://github.com/northwind/northwind-labs/actions');
	});

	it('writes a literal strikethrough-looking brand and recognizes the end state', () => {
		const dir = createFixture();
		const run = runSetup(dir, [...REQUIRED, ...IDENTITY, '--brand', '~~Northwind~~']);
		expect(run.code, run.stderr).toBe(0);
		const afterFirst = snapshot(dir);
		expect(afterFirst['README.md'].split('\n')[0]).toBe('# \\~\\~Northwind\\~\\~');

		const rerun = runSetup(dir, []);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(afterFirst);
	});

	it('uses an option-safe directory for a repository basename starting with a hyphen', () => {
		const dir = createFixture();
		const run = runSetup(dir, [
			'--slug',
			'northwind-project',
			'--repo',
			'northwind/-project',
			...IDENTITY
		]);
		expect(run.code, run.stderr).toBe(0);
		expect(readFileSync(join(dir, 'README.md'), 'utf-8')).toContain(
			'git clone https://github.com/northwind/-project.git\ncd ./-project\n'
		);
	});

	it('keeps a foreign fenced demo while removing the template paragraph', () => {
		const dir = createFixture();
		const readme = join(dir, 'README.md');
		const foreignFence =
			'```markdown\n> [Live demo!](https://vendor.example) Keep this example byte-identical.\n\n```\n\n';
		writeFileSync(
			readme,
			readFileSync(readme, 'utf-8').replace('> [Live demo!]', foreignFence + '> [Live demo!]'),
			'utf-8'
		);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const updated = readFileSync(readme, 'utf-8');
		expect(updated).toContain(foreignFence);
		expect(updated.match(/Live demo!/g)).toHaveLength(1);
		expect(updated).not.toContain('https://saas.daniel.sticker.name');
	});

	it('removes the live demo from a fully CRLF-encoded README', () => {
		const dir = createFixture();
		const readme = join(dir, 'README.md');
		writeFileSync(readme, readFileSync(readme, 'utf-8').replace(/\n/g, '\r\n'), 'utf-8');

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const updated = readFileSync(readme, 'utf-8');
		expect(updated).not.toContain('Live demo!');
		expect(updated).not.toMatch(/[^\r]\n/);
	});

	it('keeps the root name in manifest and lockfile in sync', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);

		const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
		const lock = readFileSync(join(dir, 'bun.lock'), 'utf-8');
		expect(pkg.name).toBe('northwind-labs');
		expect(/"workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"([^"]*)"/.exec(lock)?.[1]).toBe(
			'northwind-labs'
		);
		// Only the root name changes; the dependency graph remains byte-identical.
		expect(lock).toBe(
			readFileSync(join(ROOT, 'bun.lock'), 'utf-8').replace(
				'"name": "saas-starter"',
				'"name": "northwind-labs"'
			)
		);
	});

	it('keeps environment worker names byte-identical', () => {
		const dir = createFixture();
		const wrangler = join(dir, 'wrangler.toml');
		const environment = '\n[env.staging]\nname = "staging-worker" # keep me\n';
		writeFileSync(wrangler, readFileSync(wrangler, 'utf-8') + environment, 'utf-8');

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const updated = readFileSync(wrangler, 'utf-8');
		expect(updated).toMatch(/^name = "northwind-labs"/m);
		expect(updated.endsWith(environment)).toBe(true);
	});

	it('ignores root-looking syntax inside multiline TOML strings', () => {
		const dir = createFixture();
		const wrangler = join(dir, 'wrangler.toml');
		const stringValues = `description = """
name = "basic-string"
[example.basic]
"""
literal = '''
name = "literal-string"
[example.literal]
'''
`;
		writeFileSync(wrangler, stringValues + readFileSync(wrangler, 'utf-8'), 'utf-8');

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const updated = readFileSync(wrangler, 'utf-8');
		expect(updated).toContain(stringValues);
		expect(updated).toMatch(/^name = "northwind-labs" # TEMPLATE:/m);
	});
});

describe('template setup finds the runtime repository property', () => {
	it('ignores comments, strings, and interface signatures around SITE_CONFIG', () => {
		const dir = createFixture();
		const site = join(dir, 'src/lib/config/site.ts');
		writeFileSync(
			site,
			readFileSync(site, 'utf-8')
				.replace(
					'export interface SiteConfig {',
					"// githubSlug: 'comment/line'\nconst example = \"githubSlug: 'string/example'\";\n\nexport interface SiteConfig {\n\t/** githubSlug: 'comment/doc' */"
				)
				.replace(
					"\tgithubSlug: 'stickerdaniel/saas-starter',",
					"\t/*\n\t * githubSlug: 'comment/block'\n\t */\n\tgithubSlug: 'stickerdaniel/saas-starter',"
				),
			'utf-8'
		);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const updated = readFileSync(site, 'utf-8');
		expect(updated).toContain("githubSlug: 'northwind/northwind-labs'");
		expect(updated).toContain("githubSlug: 'comment/block'");
		expect(updated).toContain("githubSlug: 'string/example'");
	});
});

describe('template setup rejects input before writing', () => {
	it.each([
		{
			label: 'an unknown flag',
			args: [...REQUIRED, ...IDENTITY, '--barnd', 'typo'],
			expected: /Unknown option '--barnd'/
		},
		{
			label: 'an unknown boolean flag',
			args: [...REQUIRED, ...IDENTITY, '--verbose'],
			expected: /Unknown option '--verbose'/
		},
		{
			label: 'an invalid slug',
			args: ['--slug', 'Northwind Labs', '--repo', 'northwind/northwind-labs', ...IDENTITY],
			expected: /slug must match/
		},
		{
			label: 'a leading slug hyphen in attached flag form',
			args: ['--slug=-northwind', '--repo', 'northwind/northwind-labs', ...IDENTITY],
			expected: /slug must match/
		},
		{
			label: 'a trailing slug hyphen',
			args: ['--slug', 'northwind-', '--repo', 'northwind/northwind-labs', ...IDENTITY],
			expected: /slug must match/
		},
		{
			label: 'a 64-character worker slug',
			args: ['--slug', 'n'.repeat(64), '--repo', 'northwind/northwind-labs', ...IDENTITY],
			expected: /slug must match/
		},
		{
			label: 'an unsafe repository',
			args: ['--slug', 'northwind-labs', '--repo', 'northwind/repo.git', ...IDENTITY],
			expected: /repo must use a safe GitHub owner\/name format/
		},
		{
			label: 'a 101-character repository name',
			args: ['--slug', 'northwind-labs', '--repo', `northwind/${'r'.repeat(101)}`, ...IDENTITY],
			expected: /repo must use a safe GitHub owner\/name format/
		},
		{
			label: 'a repository basename ending in a period',
			args: ['--slug', 'northwind-labs', '--repo', 'northwind/project.', ...IDENTITY],
			expected: /repo must use a safe GitHub owner\/name format/
		},
		{
			label: 'a reserved clone directory basename',
			args: ['--slug', 'northwind-labs', '--repo', 'northwind/con', ...IDENTITY],
			expected: /repo basename must be safe for the generated cross-platform clone directory/
		},
		{
			label: 'a reserved clone directory basename before an extension',
			args: ['--slug', 'northwind-labs', '--repo', 'northwind/COM1.project', ...IDENTITY],
			expected: /repo basename must be safe for the generated cross-platform clone directory/
		},
		{
			label: 'an invalid email',
			args: [...REQUIRED, ...IDENTITY.slice(0, -1), 'kaputt'],
			expected: /email must use the consumer-compatible user@domain\.tld subset/
		},
		{
			label: 'a Unicode email localpart longer than 64 UTF-8 bytes',
			args: [...REQUIRED, ...IDENTITY.slice(0, -1), `${'é'.repeat(33)}@example.de`],
			expected: /email must use the consumer-compatible user@domain\.tld subset/
		},
		{
			label: 'a 64-byte localpart with a 190-byte ASCII domain',
			args: [
				...REQUIRED,
				...IDENTITY.slice(0, -1),
				`${'a'.repeat(64)}@${asciiDomainOfLength(190)}`
			],
			expected: /email must use the consumer-compatible user@domain\.tld subset/
		},
		{
			label: 'a one-byte localpart with a 253-byte ASCII domain',
			args: [...REQUIRED, ...IDENTITY.slice(0, -1), `a@${asciiDomainOfLength(253)}`],
			expected: /email must use the consumer-compatible user@domain\.tld subset/
		},
		{
			label: 'missing required values without a TTY',
			args: [],
			expected: /needs --slug, --repo, --brand in non-interactive mode/
		}
	])('leaves every file untouched given $label', ({ args, expected }) => {
		const dir = createFixture();
		const before = snapshot(dir);

		const run = runSetup(dir, args);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(expected);
		expect(snapshot(dir)).toEqual(before);
	});

	it.each([
		{
			label: 'the site config lost its githubSlug',
			file: 'src/lib/config/site.ts',
			mutate: (source: string) => source.replace(/\tgithubSlug: '[^']*',\n/, ''),
			expected: /Could not find githubSlug/
		},
		{
			label: 'the site config carries duplicate direct githubSlug properties',
			file: 'src/lib/config/site.ts',
			mutate: (source: string) =>
				source.replace(
					"\tgithubSlug: 'stickerdaniel/saas-starter',",
					"\tgithubSlug: 'stickerdaniel/saas-starter',\n\tgithubSlug: 'other/repository',"
				),
			expected: /Expected exactly one direct githubSlug property/
		},
		{
			label: 'the site config uses a non-literal githubSlug value',
			file: 'src/lib/config/site.ts',
			mutate: (source: string) =>
				source.replace("githubSlug: 'stickerdaniel/saas-starter'", 'githubSlug: repository'),
			expected: /direct string literal/
		},
		{
			label: 'the legal config lost its export block',
			file: 'src/lib/config/legal.ts',
			mutate: (source: string) =>
				source.replace(
					/^export const LEGAL_CONFIG[\s\S]*?^\} as const;$/m,
					"export const LEGAL_CONFIG = { brandName: 'X' };"
				),
			expected: /LEGAL_CONFIG must use a direct object initializer/
		},
		{
			label: 'the README lost its quick start',
			file: 'README.md',
			mutate: () => '# Custom Title\n\nUnrelated prose.\n',
			expected: /Expected exactly one Quick Start H2/
		},
		{
			label: 'wrangler.toml lost its name assignment',
			file: 'wrangler.toml',
			mutate: (source: string) => source.replace(/^name = "[^"]*".*\n/m, ''),
			expected: /Expected exactly one name assignment/
		},
		{
			label: 'wrangler.toml uses a multiline basic string for the root name',
			file: 'wrangler.toml',
			mutate: (source: string) => source.replace(/^name = "[^"]*".*$/m, 'name = """base-worker"""'),
			expected: /Expected exactly one name assignment/
		},
		{
			label: 'wrangler.toml uses a multiline literal string for the root name',
			file: 'wrangler.toml',
			mutate: (source: string) => source.replace(/^name = "[^"]*".*$/m, "name = '''base-worker'''"),
			expected: /Expected exactly one name assignment/
		}
	])('leaves every file untouched when $label', ({ file, mutate, expected }) => {
		const dir = createFixture();
		writeFileSync(join(dir, file), mutate(readFileSync(join(dir, file), 'utf-8')), 'utf-8');
		const before = snapshot(dir);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(expected);
		expect(snapshot(dir)).toEqual(before);
	});

	it.each([
		['Date', (source: string) => source.replace('{\n', '{\n\tunsupported: new Date(0),\n')],
		['Map', (source: string) => source.replace('{\n', '{\n\tunsupported: new Map(),\n')],
		['Set', (source: string) => source.replace('{\n', '{\n\tunsupported: new Set(),\n')],
		['RegExp', (source: string) => source.replace('{\n', '{\n\tunsupported: /value/,\n')],
		[
			'class instance',
			(source: string) =>
				`class UnsupportedConfigValue {}\n${source.replace(
					'{\n',
					'{\n\tunsupported: new UnsupportedConfigValue(),\n'
				)}`
		],
		[
			'null-prototype object',
			(source: string) =>
				source.replace(
					'{\n',
					"{\n\tunsupported: Object.assign(Object.create(null), { value: 'kept' }),\n"
				)
		],
		[
			'own __proto__ data property',
			(source: string) => source.replace('{\n', "{\n\t['__proto__']: 'kept',\n")
		]
	])('rejects an imported %s before normalization or writes', (_label, mutate) => {
		const dir = createFixture();
		const legal = join(dir, 'src/lib/config/legal.ts');
		writeFileSync(legal, mutate(readFileSync(legal, 'utf-8')), 'utf-8');
		const before = snapshot(dir);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/Unsupported LEGAL_CONFIG/);
		expect(snapshot(dir)).toEqual(before);
	});
});

describe('template setup recognizes a genuinely set up project', () => {
	// A hand-edited package name or githubSlug does not prove setup while Quick Start is bootstrap.
	it.each([
		{
			label: 'only the package name was renamed by hand',
			mutate: (dir: string) => {
				const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
				pkg.name = 'renamed-by-hand';
				writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, '\t') + '\n', 'utf-8');
			}
		},
		{
			label: 'the package name and the githubSlug were edited by hand',
			mutate: (dir: string) => {
				const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
				pkg.name = 'renamed-by-hand';
				writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, '\t') + '\n', 'utf-8');
				const site = join(dir, 'src/lib/config/site.ts');
				writeFileSync(
					site,
					readFileSync(site, 'utf-8').replace(
						"githubSlug: 'stickerdaniel/saas-starter'",
						"githubSlug: 'someone/edited-by-hand'"
					),
					'utf-8'
				);
			}
		}
	])('still demands --brand when $label', ({ mutate }) => {
		const dir = createFixture();
		mutate(dir);
		const before = snapshot(dir);

		const run = runSetup(dir, ['--slug', 'renamed-by-hand', '--repo', 'northwind/northwind-labs']);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/Missing: --brand/);
		expect(snapshot(dir)).toEqual(before);
	});

	it('rejects a flagless run when only githubSlug and the clone block were edited', () => {
		const dir = createFixture();
		const site = join(dir, 'src/lib/config/site.ts');
		writeFileSync(
			site,
			readFileSync(site, 'utf-8').replace(
				"githubSlug: 'stickerdaniel/saas-starter'",
				"githubSlug: 'northwind/northwind-labs'"
			),
			'utf-8'
		);
		const readme = join(dir, 'README.md');
		writeFileSync(
			readme,
			readFileSync(readme, 'utf-8').replace(
				'gh repo create my-saas-product --template stickerdaniel/saas-starter --clone\ncd my-saas-product',
				'git clone https://github.com/northwind/northwind-labs.git\ncd ./northwind-labs'
			),
			'utf-8'
		);
		const before = snapshot(dir);

		const run = runSetup(dir, []);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/needs --slug, --repo, --brand in non-interactive mode/);
		expect(snapshot(dir)).toEqual(before);
	});

	it('stops demanding flags once the full generated README state is consistent', () => {
		const dir = createFixture();
		// Deliberately retain the template slug.
		expect(
			runSetup(dir, [
				'--slug',
				'saas-starter',
				'--repo',
				'northwind/northwind-labs',
				'--brand',
				'Northwind Labs',
				...IDENTITY
			]).code
		).toBe(0);
		const afterFirst = snapshot(dir);

		const rerun = runSetup(dir, []);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(rerun.stderr).not.toMatch(/Missing:/);
		expect(snapshot(dir)).toEqual(afterFirst);
	});

	it('recognizes the previous bare cd form on a re-run', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
		const readme = join(dir, 'README.md');
		writeFileSync(
			readme,
			readFileSync(readme, 'utf-8').replace('cd ./northwind-labs', 'cd northwind-labs'),
			'utf-8'
		);

		const rerun = runSetup(dir, []);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(rerun.stderr).not.toMatch(/Missing:/);
		expect(readFileSync(readme, 'utf-8')).toContain('cd ./northwind-labs');
	});

	it('leaves a CRLF README byte-identical on a re-run', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
		const readme = join(dir, 'README.md');
		writeFileSync(readme, readFileSync(readme, 'utf-8').replace(/\n/g, '\r\n'), 'utf-8');
		const afterFirst = snapshot(dir);

		const rerun = runSetup(dir, []);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(afterFirst);
		expect(readFileSync(readme, 'utf-8')).toContain('\r\n');
	});

	it('keeps an existing empty company name instead of deriving one', () => {
		const dir = createFixture();
		const legal = join(dir, 'src/lib/config/legal.ts');
		writeFileSync(
			legal,
			readFileSync(legal, 'utf-8').replace(/companyName: '[^']*'/, "companyName: ''"),
			'utf-8'
		);

		expect(
			runSetup(dir, [...REQUIRED, '--brand', 'Northwind', ...IDENTITY_WITHOUT_COMPANY]).code
		).toBe(0);
		const imported = importLegalConfig(dir);
		expect(imported.code, imported.stderr).toBe(0);
		expect(imported.value?.config.companyName).toBe('');
		const afterFirst = snapshot(dir);

		const rerun = runSetup(dir, []);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(afterFirst);
	});

	it('derives a company name only when the key is truly absent', () => {
		const dir = createFixture();
		const legal = join(dir, 'src/lib/config/legal.ts');
		writeFileSync(
			legal,
			readFileSync(legal, 'utf-8').replace(/\tcompanyName: '[^']*',\n/, ''),
			'utf-8'
		);

		expect(
			runSetup(dir, [...REQUIRED, '--brand', 'Northwind', ...IDENTITY_WITHOUT_COMPANY]).code
		).toBe(0);
		const imported = importLegalConfig(dir);
		expect(imported.code, imported.stderr).toBe(0);
		expect(imported.value?.config.companyName).toBe('Northwind Inc.');
	});
});

describe('template setup keeps prose values on one line', () => {
	const multiline = 'Northwind Labs\n\n## Injected Heading\n\nmore text';

	// Brand and operator enter Privacy and Terms paragraphs as raw text.
	it.each([
		{ flag: '--brand', expected: /brand must be a single line/ },
		{ flag: '--operator', expected: /operator must be a single line/ }
	])('rejects a multi-line $flag before writing', ({ flag, expected }) => {
		const dir = createFixture();
		const before = snapshot(dir);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY, flag, multiline]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(expected);
		expect(snapshot(dir)).toEqual(before);
	});

	it('still accepts a multi-line address', () => {
		const dir = createFixture();
		const run = runSetup(dir, [
			...REQUIRED,
			...IDENTITY,
			'--address',
			'Hauptstrasse 5\n12345 Berlin\nDeutschland'
		]);

		expect(run.code, run.stderr).toBe(0);
		const imported = importLegalConfig(dir);
		expect(imported.code, imported.stderr).toBe(0);
		expect(imported.value?.config.address).toBe('Hauptstrasse 5\n12345 Berlin\nDeutschland');
	});
});

describe('template setup contact email end to end', () => {
	it.each([
		'a@b@c.de',
		'erste person@example.de',
		'a@ex ample.de',
		'a@example..de',
		'a?subject=changed@example.de',
		'a#fragment@example.de',
		'a/path@example.de',
		'a%20name@example.de',
		'a@-example.de',
		'a@example-.de',
		`a@${'d'.repeat(64)}.de`
	])('rejects %s before writing', (value) => {
		const dir = createFixture();
		const before = snapshot(dir);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY.slice(0, 6), '--email', value]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/email must use the consumer-compatible user@domain\.tld subset/);
		expect(snapshot(dir)).toEqual(before);
	});

	it('keeps plus, apostrophe, and Unicode in the supported subset', () => {
		const dir = createFixture();
		const email = "jörg+o'connor@münchen.example";
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY.slice(0, 6), '--email', email]).code).toBe(0);

		const imported = importLegalConfig(dir);
		expect(imported.code, imported.stderr).toBe(0);
		expect(imported.value?.config.email).toEqual({
			user: "jörg+o'connor",
			domain: 'münchen',
			tld: 'example'
		});
		expect(imported.value?.mailto).toBe(email);
	});

	it('keeps a subdomain address split into three parts', () => {
		const dir = createFixture();
		expect(
			runSetup(dir, [...REQUIRED, ...IDENTITY.slice(0, 6), '--email', 'a@mail.example.com']).code
		).toBe(0);

		const imported = importLegalConfig(dir);
		expect(imported.code, imported.stderr).toBe(0);
		expect(imported.value?.config.email).toEqual({
			user: 'a',
			domain: 'mail',
			tld: 'example.com'
		});
		expect(imported.value?.mailto).toBe('a@mail.example.com');
	});
});

const SINGLE_REPLACE_OUTPUTS = [
	'package.json',
	'bun.lock',
	'wrangler.toml',
	'README.md',
	'src/lib/config/site.ts'
] as const;

const SINGLE_REPLACE_FAULTS = ['write', 'partial-write', 'single-install'] as const;

describe('template setup atomic single-file replacements', () => {
	it.each(
		SINGLE_REPLACE_OUTPUTS.flatMap((target) =>
			SINGLE_REPLACE_FAULTS.map((phase) => ({ target, phase }))
		)
	)('keeps $target whole after a $phase fault and converges on retry', ({ target, phase }) => {
		const expectedDir = createFixture();
		const expectedRun = runSetup(expectedDir, [...REQUIRED, ...IDENTITY]);
		expect(expectedRun.code, expectedRun.stderr).toBe(0);
		const expected = snapshot(expectedDir);

		const dir = createFixture();
		const before = snapshot(dir);
		const fault = createFaultPreload(dir, { phase, target });
		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);
		expectFault(failed, fault, phase === 'single-install' ? 'renameSync' : 'writeFileSync');
		if (phase !== 'single-install') {
			expect(failed.stderr).toContain('stage=true');
			expect(failed.stderr).toContain('flag=wx');
		}
		if (phase === 'partial-write') expect(failed.stderr).toContain('prefix=true');

		const partial = snapshot(dir);
		expect(partial[target]).toBe(before[target]);
		for (const rel of FIXTURE_FILES) {
			expect([before[rel], expected[rel]]).toContain(partial[rel]);
		}

		const retry = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(retry.code, retry.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(expected);
	});

	it('accepts a flagless retry after the final site replacement committed before cleanup failed', () => {
		const dir = createFixture();
		const fault = createFaultPreload(dir, {
			phase: 'single-cleanup-rmdir',
			target: 'src/lib/config/site.ts'
		});
		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);
		expectFault(failed, fault, 'rmdirSync');
		expect(readFileSync(join(dir, 'README.md'), 'utf-8')).toContain(
			'git clone https://github.com/northwind/northwind-labs.git'
		);
		expect(readFileSync(join(dir, 'src/lib/config/site.ts'), 'utf-8')).toContain(
			"githubSlug: 'northwind/northwind-labs'"
		);

		const retry = runSetup(dir, []);
		expect(retry.code, retry.stderr).toBe(0);
	});
});

const LEGAL_OUTPUTS = ['src/lib/config/legal.ts', 'src/lib/content/legal-metadata.ts'] as const;

function setLegalModes(dir: string): { config: number; metadata: number } {
	chmodSync(join(dir, LEGAL_OUTPUTS[0]), 0o640);
	chmodSync(join(dir, LEGAL_OUTPUTS[1]), 0o604);
	const modes = { config: mode(dir, LEGAL_OUTPUTS[0]), metadata: mode(dir, LEGAL_OUTPUTS[1]) };
	if (process.platform !== 'win32') expect(modes.config).not.toBe(modes.metadata);
	return modes;
}

const LEGAL_PREPARE_FAULTS = ['write', 'partial-write', 'chmod'] as const;

describe('template setup legal pair commit protocol', () => {
	it.each(
		LEGAL_OUTPUTS.flatMap((target) => LEGAL_PREPARE_FAULTS.map((phase) => ({ target, phase })))
	)('leaves the original pair after a $phase fault for $target', ({ target, phase }) => {
		const expectedDir = createFixture();
		setLegalModes(expectedDir);
		const expectedRun = runSetup(expectedDir, [...REQUIRED, ...IDENTITY]);
		expect(expectedRun.code, expectedRun.stderr).toBe(0);
		const expected = snapshot(expectedDir);

		const dir = createFixture();
		const originalModes = setLegalModes(dir);
		const before = snapshot(dir);
		const fault = createFaultPreload(dir, { phase, target });
		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);
		expectFault(failed, fault, phase === 'chmod' ? 'chmodSync' : 'writeFileSync');
		expect(failed.stderr).toContain('stage=true');
		if (phase !== 'chmod') expect(failed.stderr).toContain('flag=wx');
		if (phase === 'partial-write') expect(failed.stderr).toContain('prefix=true');
		expect(snapshot(dir)).toEqual(before);
		expect(mode(dir, LEGAL_OUTPUTS[0])).toBe(originalModes.config);
		expect(mode(dir, LEGAL_OUTPUTS[1])).toBe(originalModes.metadata);

		const retry = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(retry.code, retry.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(expected);
		expect(mode(dir, LEGAL_OUTPUTS[0])).toBe(originalModes.config);
		expect(mode(dir, LEGAL_OUTPUTS[1])).toBe(originalModes.metadata);
	});

	it.each([
		{ phase: 'legal-backup' as const, operation: 'renameSync' },
		{ phase: 'legal-config-install' as const, operation: 'renameSync' },
		{ phase: 'legal-metadata-install' as const, operation: 'renameSync' }
	])('restores the original pair after $phase fails before commit', ({ phase, operation }) => {
		const dir = createFixture();
		const originalModes = setLegalModes(dir);
		const before = snapshot(dir);
		const fault = createFaultPreload(dir, { phase, target: LEGAL_OUTPUTS[0] });
		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);
		expectFault(failed, fault, operation);
		expect(snapshot(dir)).toEqual(before);
		expect(mode(dir, LEGAL_OUTPUTS[0])).toBe(originalModes.config);
		expect(mode(dir, LEGAL_OUTPUTS[1])).toBe(originalModes.metadata);

		const retry = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(retry.code, retry.stderr).toBe(0);
	});

	it('preserves the backup and recovery file when restoring the config fails', () => {
		const dir = createFixture();
		const beforeConfig = readFileSync(join(dir, LEGAL_OUTPUTS[0]));
		const beforeMetadata = readFileSync(join(dir, LEGAL_OUTPUTS[1]));
		const fault = createFaultPreload(dir, {
			phase: 'legal-metadata-and-restore',
			target: LEGAL_OUTPUTS[0]
		});
		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);

		expect(failed.code).toBe(1);
		expect(failed.stderr).toContain(`FAULT_HIT ${fault.id} operation=renameSync`);
		expect(failed.stderr).toContain(`FAULT_HIT ${fault.id} operation=renameSync-restore`);
		expect(failed.stderr).toContain('template-setup.ts');
		expect(failed.stderr).toMatch(/Recovery required/);
		expect(failed.stderr).toMatch(/legal\.ts\.backup/);
		expect(failed.stderr).toMatch(/canonical config=.*canonical metadata=/);
		expect(existsSync(join(dir, LEGAL_OUTPUTS[0]))).toBe(false);
		expect(readFileSync(join(dir, LEGAL_OUTPUTS[1]))).toEqual(beforeMetadata);

		const stages = stagingArtifacts(dir);
		expect(stages.length).toBeGreaterThan(0);
		const retained = stages.flatMap((stage) =>
			readdirSync(stage).map((entry) => ({
				path: join(stage, entry),
				bytes: readFileSync(join(stage, entry))
			}))
		);
		expect(retained.some(({ path }) => path.endsWith('legal.ts.backup'))).toBe(true);
		expect(retained.some(({ bytes }) => bytes.equals(beforeConfig))).toBe(true);
		expect(retained.some(({ path }) => path.endsWith('legal.ts.recovery'))).toBe(true);
	});

	it.each([
		{ phase: 'legal-cleanup-unlink' as const, operation: 'unlinkSync' },
		{ phase: 'legal-cleanup-rmdir' as const, operation: 'rmdirSync' }
	])('keeps the committed pair after $phase fails', ({ phase, operation }) => {
		const expectedDir = createFixture();
		setLegalModes(expectedDir);
		expect(runSetup(expectedDir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
		const expectedConfig = readFileSync(join(expectedDir, LEGAL_OUTPUTS[0]));
		const expectedMetadata = readFileSync(join(expectedDir, LEGAL_OUTPUTS[1]));

		const dir = createFixture();
		const originalModes = setLegalModes(dir);
		const fault = createFaultPreload(dir, { phase, target: LEGAL_OUTPUTS[0] });
		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);
		expectFault(failed, fault, operation);
		expect(readFileSync(join(dir, LEGAL_OUTPUTS[0]))).toEqual(expectedConfig);
		expect(readFileSync(join(dir, LEGAL_OUTPUTS[1]))).toEqual(expectedMetadata);
		expect(mode(dir, LEGAL_OUTPUTS[0])).toBe(originalModes.config);
		expect(mode(dir, LEGAL_OUTPUTS[1])).toBe(originalModes.metadata);
		expect(stagingArtifacts(dir).length).toBeGreaterThan(0);

		const retry = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(retry.code, retry.stderr).toBe(0);
		expect(readFileSync(join(dir, LEGAL_OUTPUTS[0]))).toEqual(expectedConfig);
		expect(readFileSync(join(dir, LEGAL_OUTPUTS[1]))).toEqual(expectedMetadata);
	});
});

describe('template setup path preflight', () => {
	it('rejects a symlink target before creating staging directories', () => {
		const dir = createFixture();
		const readme = join(dir, 'README.md');
		const realReadme = join(dir, 'README.real.md');
		renameSync(readme, realReadme);
		symlinkSync('README.real.md', readme, 'file');
		const before = readFileSync(realReadme);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/regular file|symbolic link|symlink/i);
		expect(readFileSync(realReadme)).toEqual(before);
		expect(stagingArtifacts(dir)).toEqual([]);
	});

	it('rejects a hardlink target before creating staging directories', () => {
		const dir = createFixture();
		const readme = join(dir, 'README.md');
		const peer = join(dir, 'README.peer.md');
		renameSync(readme, peer);
		linkSync(peer, readme);
		const before = readFileSync(peer);
		expect(lstatSync(readme).nlink).toBeGreaterThan(1);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/hardlink|link count|nlink/i);
		expect(readFileSync(peer)).toEqual(before);
		expect(stagingArtifacts(dir)).toEqual([]);
	});

	it('rejects a real parent outside the repository root before staging', () => {
		const dir = createFixture();
		const config = join(dir, 'src/lib/config');
		const outside = mkdtempSync(join(tmpdir(), 'template-setup-outside-'));
		fixtures.push(outside);
		cpSync(config, outside, { recursive: true });
		rmSync(config, { recursive: true });
		symlinkSync(outside, config, process.platform === 'win32' ? 'junction' : 'dir');
		const beforeLegal = readFileSync(join(outside, 'legal.ts'));
		const beforeSite = readFileSync(join(outside, 'site.ts'));

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/outside.*repository|repository root/i);
		expect(readFileSync(join(outside, 'legal.ts'))).toEqual(beforeLegal);
		expect(readFileSync(join(outside, 'site.ts'))).toEqual(beforeSite);
		expect(stagingArtifacts(dir)).toEqual([]);
	});
});

describe('template setup structural process guards', () => {
	it('rejects a template decoy with an indirect real LEGAL_CONFIG before writes', () => {
		const dir = createFixture();
		const legal = join(dir, 'src/lib/config/legal.ts');
		const direct = readFileSync(legal, 'utf-8');
		const block = /^export const LEGAL_CONFIG = \{[\s\S]*?^\} as const;$/m.exec(direct)?.[0];
		expect(block).toBeDefined();
		const indirect = direct.replace(
			block!,
			`const currentConfig = ${block!.replace('export const LEGAL_CONFIG = ', '')}\nconst decoy = \`export const LEGAL_CONFIG = { brandName: 'Decoy' } as const;\`;\nexport const LEGAL_CONFIG = currentConfig;`
		);
		writeFileSync(legal, indirect, 'utf-8');
		const before = snapshot(dir);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/LEGAL_CONFIG/);
		expect(snapshot(dir)).toEqual(before);
		expect(stagingArtifacts(dir)).toEqual([]);
	});

	it('rejects a foreign clone example when the real Quick Start candidate is missing', () => {
		const dir = createFixture();
		const readme = join(dir, 'README.md');
		const source = readFileSync(readme, 'utf-8')
			.replace(
				'gh repo create my-saas-product --template stickerdaniel/saas-starter --clone\ncd my-saas-product\nbun install\nbun run dev',
				'mkdir my-saas-product\nbun install\nbun run dev'
			)
			.concat(
				'\n## Unrelated Vendor Checkout\n\n```bash\ngit clone https://github.com/example/vendor-tool.git\ncd vendor-tool\nbun install\nbun run dev\n```\n'
			);
		writeFileSync(readme, source, 'utf-8');
		const before = snapshot(dir);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/candidate/);
		expect(snapshot(dir)).toEqual(before);
		expect(stagingArtifacts(dir)).toEqual([]);
	});

	it('rejects multiple real live demo paragraphs before writes', () => {
		const dir = createFixture();
		const readme = join(dir, 'README.md');
		writeFileSync(
			readme,
			readFileSync(readme, 'utf-8').replace(
				'## Why This Exists',
				'> [Live demo!](https://another.example) Another template demo.\n\n## Why This Exists'
			),
			'utf-8'
		);
		const before = snapshot(dir);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/live demo.*found 2/i);
		expect(run.stdout).not.toContain('Applying:');
		expect(snapshot(dir)).toEqual(before);
		expect(stagingArtifacts(dir)).toEqual([]);
	});

	it('rewrites repository URLs before closing punctuation in the public process', () => {
		const dir = createFixture();
		const readme = join(dir, 'README.md');
		const oldUrl = 'https://github.com/stickerdaniel/saas-starter';
		const newUrl = 'https://github.com/northwind/northwind-labs';
		const sentenceUrls = [
			`${oldUrl}.)`,
			`${oldUrl}."`,
			`${oldUrl}.']`,
			`${oldUrl}.git.)`,
			`${oldUrl}.git."`,
			`${oldUrl}.git.']`
		].join('\n');
		writeFileSync(
			readme,
			readFileSync(readme, 'utf-8').replace(
				'## Why This Exists',
				`${sentenceUrls}\n\n## Why This Exists`
			),
			'utf-8'
		);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const afterFirst = readFileSync(readme, 'utf-8');
		expect(afterFirst).not.toContain(oldUrl);
		expect(afterFirst).toContain(`${newUrl}.)`);
		expect(afterFirst).toContain(`${newUrl}."`);
		expect(afterFirst).toContain(`${newUrl}.']`);
		expect(afterFirst).toContain(`${newUrl}.git.)`);
		expect(afterFirst).toContain(`${newUrl}.git."`);
		expect(afterFirst).toContain(`${newUrl}.git.']`);

		const rerun = runSetup(dir, []);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(readFileSync(readme, 'utf-8')).not.toContain(oldUrl);
	});
});

/**
 * This test measures a real denied write. Root can bypass 0444 permissions, so the
 * case reports itself as unobservable there instead of claiming coverage.
 */
const writeDenialEnforced = (() => {
	const dir = mkdtempSync(join(tmpdir(), 'template-setup-wperm-'));
	fixtures.push(dir);
	const probe = join(dir, 'probe.txt');
	writeFileSync(probe, 'x', 'utf-8');
	chmodSync(probe, 0o444);
	try {
		writeFileSync(probe, 'y', 'utf-8');
		return false;
	} catch {
		return true;
	} finally {
		chmodSync(probe, 0o644);
	}
})();

const parentWriteDenialEnforced = (() => {
	const dir = mkdtempSync(join(tmpdir(), 'template-setup-dperm-'));
	fixtures.push(dir);
	chmodSync(dir, 0o555);
	try {
		const probe = mkdtempSync(join(dir, 'probe-'));
		rmSync(probe, { recursive: true, force: true });
		return false;
	} catch {
		return true;
	} finally {
		chmodSync(dir, 0o755);
	}
})();

describe('template setup checks write access before the first write', () => {
	it.skipIf(!writeDenialEnforced)('writes nothing when a planned output file is read-only', () => {
		const dir = createFixture();
		const readme = join(dir, 'README.md');
		chmodSync(readme, 0o444);
		const before = snapshot(dir);

		try {
			const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(run.code).toBe(1);
			expect(run.stderr).toMatch(/Cannot write README\.md; check file permissions/);
			expect(snapshot(dir)).toEqual(before);
		} finally {
			chmodSync(readme, 0o644);
		}
	});

	it.skipIf(!parentWriteDenialEnforced)(
		'writes nothing when a canonical parent directory is read-only',
		() => {
			const dir = createFixture();
			const rootFiles = ['package.json', 'bun.lock', 'README.md', 'wrangler.toml'] as const;
			const before = snapshot(dir);
			chmodSync(dir, 0o555);

			try {
				expect(() => mkdtempSync(join(dir, '.write-probe-'))).toThrow();
				for (const rel of rootFiles) accessSync(join(dir, rel), constants.W_OK);
				accessSync(join(dir, 'src/lib/config'), constants.W_OK);
				accessSync(join(dir, 'src/lib/content'), constants.W_OK);

				const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
				expect(run.code).toBe(1);
				expect(run.stderr).toMatch(
					/Cannot write parent directory for package\.json; check directory permissions/
				);
				expect(run.stdout).not.toContain('Applying:');
				expect(snapshot(dir)).toEqual(before);
				expect(stagingArtifacts(dir)).toEqual([]);
			} finally {
				chmodSync(dir, 0o755);
			}
		}
	);
});

describe('template setup help', () => {
	it('prints the supported flags and writes nothing', () => {
		const dir = createFixture();
		const before = snapshot(dir);

		const run = runSetup(dir, ['--help']);
		expect(run.code).toBe(0);
		expect(run.stdout).toContain('--slug');
		expect(run.stdout).toContain('Unknown flags are rejected before any file is written.');
		expect(snapshot(dir)).toEqual(before);
	});
});
