/**
 * Runs the real setup process against private fixture copies. Full processes prove
 * generated branding remains importable and rejected inputs fail before mutation.
 * Fixtures need no installed dependencies because setup imports only built-ins and
 * dependency-free local modules.
 */
import { spawn, spawnSync } from 'node:child_process';
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
	rmdirSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { BASE_TABLE, WORKSPACES } from '../.agents/skills/upstream-sync/layout/v3';
import {
	aliasMap,
	plannedSpecifiers,
	readImportEdges,
	type SpecifierChange
} from '../.agents/skills/upstream-sync/scripts/apply-layout';
import {
	buildSiteStructuredData,
	type OrganizationLegalIdentity
} from '../src/lib/seo/structured-data';
import { reduceManifest } from './export-profile';
import { testExecutable } from './test-executable';
import { required } from './required';

vi.setConfig({ testTimeout: 15_000 });

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
	'scripts/export-profile.ts',
	'scripts/path-sets.ts',
	'src/lib/config/legal.ts',
	'src/lib/config/site.ts',
	'src/lib/content/legal-content-dates.ts',
	'src/lib/content/legal-metadata.ts',
	'static/manifest.webmanifest',
	'src/app.html'
] as const;

/** Copied from the live template so the rewrite runs against the files a project ships. */
const LIVE_FILES: ReadonlySet<string> = new Set([
	'scripts/template-setup.ts',
	'scripts/export-profile.ts',
	'scripts/path-sets.ts',
	'src/lib/content/legal-metadata.ts',
	'static/manifest.webmanifest',
	'src/app.html'
]);

const fixtures: string[] = [];

afterAll(() => {
	for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** A fixture tree: the flat tree of version 2, or the workspace tree the move table makes of it. */
interface FixtureLayout {
	readonly name: 'flat' | 'workspace';
	readonly version: 2 | 3;
	/** Where the flat path `path`, a file or a directory, lies in this tree. */
	readonly place: (path: string) => string;
	readonly manifest: (text: string) => string;
}

const LAYOUTS: readonly FixtureLayout[] = [
	{ name: 'flat', version: 2, place: (path) => path, manifest: (text) => text },
	{
		name: 'workspace',
		version: 3,
		place: (path) => {
			const file = BASE_TABLE.place(path)?.to;
			if (file) return file;
			const directory = BASE_TABLE.place(`${path}/`)?.to;
			return directory ? directory.slice(0, -1) : path;
		},
		manifest: (text) =>
			JSON.stringify(
				{ ...JSON.parse(text), templateSetupVersion: 3, workspaces: ['apps/*', 'packages/*'] },
				null,
				'\t'
			) + '\n'
	}
];

const fixtureLayouts = new Map<string, FixtureLayout>();

function layoutOf(dir: string): FixtureLayout {
	const layout = fixtureLayouts.get(dir);
	if (!layout) throw new Error(`${dir} is no fixture`);
	return layout;
}

/** The path in fixture `dir` of the file or directory whose flat path is `rel`. */
function at(dir: string, rel: string): string {
	return join(dir, layoutOf(dir).place(rel));
}

function filesBelow(dir: string, rel = ''): string[] {
	return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((entry) => {
		const path = rel ? `${rel}/${entry.name}` : entry.name;
		return entry.isDirectory() ? filesBelow(dir, path) : [path];
	});
}

function removeEmptyDirectories(dir: string, rel: string): void {
	for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
		if (entry.isDirectory()) removeEmptyDirectories(dir, rel ? `${rel}/${entry.name}` : entry.name);
	}
	if (rel && readdirSync(join(dir, rel)).length === 0) rmdirSync(join(dir, rel));
}

let workspaceSpecifiers: SpecifierChange[] | undefined;

/**
 * Moves the flat fixture `dir` to the workspace tree: each path goes where the move table places it,
 * each import the move breaks gets its planned specifier, the root manifest declares version 3 and
 * its workspace patterns, and each starter workspace gets a manifest.
 */
function moveToWorkspaceTree(dir: string, manifest: FixtureLayout['manifest']): void {
	const paths = filesBelow(dir);
	workspaceSpecifiers ??= plannedSpecifiers(BASE_TABLE, readImportEdges(dir, paths), aliasMap(dir));
	for (const path of paths) {
		const to = BASE_TABLE.place(path)?.to;
		if (!to || to === path) continue;
		mkdirSync(dirname(join(dir, to)), { recursive: true });
		renameSync(join(dir, path), join(dir, to));
	}
	removeEmptyDirectories(dir, '');
	for (const { file, specifier, next } of workspaceSpecifiers) {
		const source = readFileSync(join(dir, file), 'utf-8');
		writeFileSync(join(dir, file), source.replaceAll(`'${specifier}'`, `'${next}'`));
	}
	writeFileSync(
		join(dir, 'package.json'),
		manifest(readFileSync(join(dir, 'package.json'), 'utf-8'))
	);
	for (const { root, name } of Object.values(WORKSPACES)) {
		if (name === null || existsSync(join(dir, root, 'package.json'))) continue;
		mkdirSync(join(dir, root), { recursive: true });
		writeFileSync(join(dir, root, 'package.json'), `${JSON.stringify({ name })}\n`);
	}
}

function createFixture(layout: FixtureLayout): string {
	const dir = mkdtempSync(join(tmpdir(), 'template-setup-'));
	fixtures.push(dir);
	for (const rel of FIXTURE_FILES) {
		const dest = join(dir, rel);
		mkdirSync(dirname(dest), { recursive: true });
		cpSync(
			join(ROOT, LIVE_FILES.has(rel) ? rel : `scripts/__fixtures__/template-setup/${rel}`),
			dest
		);
	}
	const child = join(dir, 'packages/create-saas-starter');
	mkdirSync(join(child, 'src'), { recursive: true });
	writeFileSync(join(child, 'package.json'), '{"name":"create-saas-starter"}\n');
	writeFileSync(join(child, 'src/index.ts'), 'export const creator = true;\n');
	mkdirSync(join(dir, 'packages/neighbor'), { recursive: true });
	writeFileSync(join(dir, 'packages/neighbor/keep.txt'), 'neighbor');
	mkdirSync(join(dir, '.github/workflows'), { recursive: true });
	writeFileSync(join(dir, '.github/workflows/create-saas-starter.yml'), 'name: creator\n');
	writeFileSync(join(dir, '.github/workflows/neighbor.yml'), 'name: neighbor\n');
	if (layout.name === 'workspace') moveToWorkspaceTree(dir, layout.manifest);
	fixtureLayouts.set(dir, layout);
	return dir;
}

function snapshot(dir: string): Record<string, string> {
	return Object.fromEntries(FIXTURE_FILES.map((rel) => [rel, readFileSync(at(dir, rel), 'utf-8')]));
}

function runSetup(dir: string, args: string[], preload?: string, env = CHILD_ENV) {
	// Use the public manifest dispatch so preload faults exercise the same process path as users.
	const command = preload
		? [`--preload=${preload}`, 'run', 'setup', ...args]
		: ['run', 'setup', ...args];
	const result = spawnSync(BUN, command, {
		cwd: dir,
		encoding: 'utf-8',
		// The manifest script starts a nested Bun runtime; propagate the same CLI preload to it.
		env: preload ? { ...env, BUN_OPTIONS: `--preload=${preload.replaceAll('\\', '/')}` } : env,
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
	| 'legal-dates-install'
	| 'legal-dates-and-restore'
	| 'legal-cleanup-unlink'
	| 'legal-cleanup-rmdir'
	| 'workflow-delete'
	| 'child-delete';

let faultSequence = 0;

function createFaultPreload(
	dir: string,
	spec: { phase: FaultPhase; target: (typeof FIXTURE_FILES)[number] }
): { id: string; path: string } {
	faultSequence += 1;
	const id = `SETUP_FAULT_${faultSequence}_${spec.phase.replaceAll('-', '_').toUpperCase()}`;
	const preload = at(dir, `fault-${faultSequence}.mjs`);
	const { place } = layoutOf(dir);
	const legal = place('src/lib/config/legal.ts');
	const legalDates = place('src/lib/content/legal-content-dates.ts');
	const source = `import { mock } from 'bun:test';
import defaultFs, * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const id = ${JSON.stringify(id)};
const phase = ${JSON.stringify(spec.phase)};
const target = ${JSON.stringify(place(spec.target))};
const legal = ${JSON.stringify(legal)};
const legalDates = ${JSON.stringify(legalDates)};
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
const realRmSync = fs.rmSync;
let datesFaulted = false;

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
			source.endsWith('/' + legal) &&
			isStage(destination) &&
			destination.endsWith('/legal.ts.backup');
		const legalConfigInstall =
			phase === 'legal-config-install' &&
			isStage(source) &&
			source.endsWith('/legal.ts') &&
			destination.endsWith('/' + legal);
		const legalDatesInstall =
			(phase === 'legal-dates-install' || phase === 'legal-dates-and-restore') &&
			isStage(source) &&
			source.endsWith('/legal-content-dates.ts') &&
			destination.endsWith('/' + legalDates);
		const legalRestore =
			phase === 'legal-dates-and-restore' &&
			datesFaulted &&
			source.endsWith('/legal.ts.backup') &&
			destination.endsWith('/' + legal);
		if (singleInstall || legalBackup || legalConfigInstall) {
			fail('renameSync', 'from=' + source + ' to=' + destination);
		}
		if (legalDatesInstall) {
			datesFaulted = true;
			fail('renameSync', 'from=' + source + ' to=' + destination);
		}
		if (legalRestore) {
			fail('renameSync-restore', 'from=' + source + ' to=' + destination);
		}
		return realRenameSync(from, to);
	},
	unlinkSync(path) {
		const normalized = normalize(path);
		if (phase === 'workflow-delete' && normalized.endsWith('/.github/workflows/create-saas-starter.yml')) {
				fail('unlinkSync', 'path=' + normalized);
			}
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
	},
	rmSync(path, options) {
		const normalized = normalize(path);
		if (phase === 'child-delete' && normalized.endsWith('/packages/create-saas-starter')) {
			realUnlinkSync(String(path) + '/package.json');
			fail('rmSync', 'path=' + normalized + ' partial=true');
		}
		return realRmSync(path, options);
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
	return lstatSync(at(dir, rel)).mode & 0o7777;
}

/** Imports the generated legal.ts in a fresh process. */
function importLegalConfig(dir: string) {
	const importer = at(dir, 'import-legal.ts');
	writeFileSync(
		importer,
		`import { LEGAL_CONFIG, formatPostalAddress, getLegalEmailAddress } from './${layoutOf(dir).place('src/lib/config/legal.ts').replace(/\.ts$/, '')}';\n` +
			'const { companyName, operatorName } = LEGAL_CONFIG;\n' +
			'const identity = { companyName, operatorName, address: LEGAL_CONFIG.address, email: getLegalEmailAddress() };\n' +
			'console.log(JSON.stringify({ config: LEGAL_CONFIG, mailto: getLegalEmailAddress(), address: formatPostalAddress(LEGAL_CONFIG.address), identity }));\n',
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
				? (JSON.parse(result.stdout) as {
						config: Record<string, unknown>;
						mailto: string;
						address: string;
						/** The structured-data builder's legal input, read from the generated module. */
						identity: OrganizationLegalIdentity;
					})
				: undefined
	};
}

const ADDRESS = [
	'--street',
	'Hauptstrasse 5',
	'--postal-code',
	'12345',
	'--city',
	'Berlin',
	'--country',
	'DE'
];

const IDENTITY = [
	'--brand',
	'Northwind Labs',
	'--company',
	'Northwind Labs GmbH',
	'--operator',
	'Anne Weber',
	...ADDRESS,
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
	...ADDRESS,
	'--email',
	'kontakt@northwind-labs.de'
];

describe.each(LAYOUTS)(
	'template setup writes importable branding values in the $name tree',
	(layout) => {
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
				// Replacement metacharacters must remain literal data.
				label: 'replacement metacharacters',
				flag: '--company',
				key: 'companyName',
				value: "Ampersand $& Backref $1 Tick $` Quote $' Co"
			}
		])('keeps a $label intact', ({ flag, key, value }) => {
			const dir = createFixture(layout);
			const run = runSetup(dir, [...REQUIRED, ...IDENTITY, flag, value]);
			expect(run.code, run.stderr).toBe(0);

			const imported = importLegalConfig(dir);
			expect(imported.code, imported.stderr).toBe(0);
			expect(imported.value?.config[key]).toBe(value);
		});

		it('prints only plain ASCII in its own progress lines', () => {
			const dir = createFixture(layout);
			const run = runSetup(dir, [...REQUIRED, ...IDENTITY, '--brand', 'Northwind (Europe)\u2122']);
			expect(run.code, run.stderr).toBe(0);
			expect(run.stdout).toContain('Template setup');
			expect(run.stdout).toContain('Setup complete.');
			expect(run.stdout).toContain('brand="Northwind (Europe)\u2122"');
			// The Applying line echoes user input, which may legitimately contain
			// Unicode; every other line is fixed script output and must stay ASCII.
			const scriptLines = run.stdout.split('\n').filter((line) => !line.startsWith('Applying:'));
			// eslint-disable-next-line no-control-regex -- the class spans ASCII, starting at NUL
			expect(scriptLines.join('\n')).not.toMatch(/[^\x00-\x7F]/);
		});

		it('brands the PWA manifest and the iOS home-screen title', () => {
			const dir = createFixture(layout);
			const run = runSetup(dir, [...REQUIRED, ...IDENTITY, '--brand', 'Northwind "Labs" & Co']);
			expect(run.code, run.stderr).toBe(0);

			const manifest = JSON.parse(readFileSync(at(dir, 'static/manifest.webmanifest'), 'utf-8'));
			expect(manifest.name).toBe('Northwind "Labs" & Co');
			expect(manifest.short_name).toBe('Northwind "Labs" & Co');
			expect(readFileSync(at(dir, 'src/app.html'), 'utf-8')).toContain(
				'<meta name="apple-mobile-web-app-title" content="Northwind &quot;Labs&quot; &amp; Co" />'
			);
		});

		it('derives the contact email helpers from the supplied address', () => {
			const dir = createFixture(layout);
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

		it('publishes the fork identity in the organization graph and About', async () => {
			const dir = createFixture(layout);
			expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);

			const imported = importLegalConfig(dir);
			expect(imported.code, imported.stderr).toBe(0);
			const data = buildSiteStructuredData({
				origin: 'https://northwind-labs.de',
				name: 'Northwind Labs',
				description: 'Northwind Labs homepage',
				languages: ['en'],
				repositoryUrl: 'https://github.com/northwind/northwind-labs',
				legal: imported.value!.identity
			}) as { '@graph': Array<Record<string, unknown>> };

			expect(data['@graph'].find((node) => node['@type'] === 'Organization')).toMatchObject({
				'@id': 'https://northwind-labs.de/#organization',
				name: 'Northwind Labs GmbH',
				contactPoint: { email: 'kontakt@northwind-labs.de' },
				address: {
					'@type': 'PostalAddress',
					streetAddress: 'Hauptstrasse 5',
					postalCode: '12345',
					addressLocality: 'Berlin',
					addressCountry: 'DE'
				}
			});

			// The page content modules read LEGAL_CONFIG once at import; load them against the written one.
			vi.resetModules();
			vi.doMock('#lib/config/legal.js', async (importOriginal) => ({
				...(await importOriginal<Record<string, unknown>>()),
				LEGAL_CONFIG: imported.value!.config
			}));
			try {
				const { aboutDocument } = await import('../src/lib/content/about');
				expect(aboutDocument.literals).toEqual({
					BRAND_NAME: 'Northwind Labs',
					OPERATOR_FIRST_NAME: 'Anne'
				});
			} finally {
				vi.doUnmock('#lib/config/legal.js');
			}
		});
	}
);

describe.each(LAYOUTS)('template setup removes maintainer files in the $name tree', (layout) => {
	const workflow = '.github/workflows/create-saas-starter.yml';
	const child = 'packages/create-saas-starter';

	it('removes populated creator targets and keeps their siblings on public setup and retry', () => {
		const dir = createFixture(layout);
		expect(readFileSync(join(dir, child, 'src/index.ts'), 'utf8')).toContain('creator');
		expect(readFileSync(at(dir, workflow), 'utf8')).toContain('creator');
		const first = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(first.code, first.stderr).toBe(0);
		expect(existsSync(at(dir, workflow))).toBe(false);
		expect(existsSync(at(dir, child))).toBe(false);
		expect(readFileSync(at(dir, 'packages/neighbor/keep.txt'), 'utf8')).toBe('neighbor');
		expect(readFileSync(at(dir, '.github/workflows/neighbor.yml'), 'utf8')).toBe(
			'name: neighbor\n'
		);
		const pkg = JSON.parse(readFileSync(at(dir, 'package.json'), 'utf8'));
		expect(pkg.templateSetupVersion).toBe(layout.version);
		expect(pkg.scripts.setup).toBe('bun scripts/template-setup.ts');
		expect(pkg.scripts.postinstall).toBe(
			'bun run generate:content && bun svelte-kit sync && varlock codegen && varlock codegen --path .env-convex.schema && bun run build:emails'
		);
		expect(pkg.scripts.test).toBe(
			'bun run test:e2e && bun run test:unit && bun run test:upstream-report'
		);
		for (const name of ['install:cli', 'check:cli', 'test:cli', 'build:cli', 'test:cli:packed']) {
			expect(pkg.scripts).not.toHaveProperty(name);
		}
		const after = snapshot(dir);
		const retry = runSetup(dir, []);
		expect(retry.code, retry.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(after);
	});

	it.each([
		{ phase: 'workflow-delete' as const, operation: 'unlinkSync' },
		{ phase: 'child-delete' as const, operation: 'rmSync' }
	])('recovers after $phase fails following canonical writes', ({ phase, operation }) => {
		const dir = createFixture(layout);
		const fault = createFaultPreload(dir, { phase, target: 'package.json' });
		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);
		expectFault(failed, fault, operation);
		expect(failed.stdout).not.toContain('Setup complete.');
		expect(JSON.parse(readFileSync(at(dir, 'package.json'), 'utf8')).scripts).not.toHaveProperty(
			'install:cli'
		);
		expect(existsSync(at(dir, child))).toBe(true);
		expect(existsSync(at(dir, workflow))).toBe(phase === 'workflow-delete');
		if (phase === 'child-delete') expect(existsSync(join(dir, child, 'package.json'))).toBe(false);
		const retry = runSetup(dir, []);
		expect(retry.code, retry.stderr).toBe(0);
		expect(existsSync(at(dir, workflow))).toBe(false);
		expect(existsSync(at(dir, child))).toBe(false);
	});

	it.skipIf(process.platform !== 'win32')(
		'fails on a natively locked child file and completes after the lock is released',
		async () => {
			const dir = createFixture(layout);
			const locked = join(dir, child, 'src/index.ts');
			// A FileStream without FileShare.Delete makes the real Windows delete fail with a sharing
			// violation, unlike an interceptor that throws before Bun reaches the primitive.
			const locker = spawn(
				'powershell.exe',
				[
					'-NoProfile',
					'-NonInteractive',
					'-Command',
					"$stream = [System.IO.File]::Open($env:SETUP_LOCK_PATH, 'Open', 'ReadWrite', 'None'); [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $stream.Dispose()"
				],
				{ env: { ...CHILD_ENV, SETUP_LOCK_PATH: locked }, stdio: ['pipe', 'pipe', 'pipe'] }
			);
			// A failed spawn emits `error` and may never emit `exit`; `close` also waits for stdio.
			let spawnError: Error | undefined;
			const closed = new Promise<number | null>((resolve) => {
				locker.once('close', resolve);
				locker.once('error', (error) => {
					spawnError = error;
					resolve(null);
				});
			});
			locker.stdin.on('error', () => {});
			const waitForClose = async (ms: number) => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const timeout = new Promise<'timeout'>((resolve) => {
					timer = setTimeout(() => resolve('timeout'), ms);
				});
				try {
					return await Promise.race([closed, timeout]);
				} finally {
					clearTimeout(timer);
				}
			};
			// Never throws, so a failed assertion in the body stays the reported error.
			const release = async (): Promise<number | string | null> => {
				if (spawnError) return `Lock holder failed to spawn: ${spawnError.message}`;
				locker.stdin.end('\n');
				const cooperative = await waitForClose(10_000);
				if (cooperative !== 'timeout') return cooperative;
				locker.kill();
				const killed = await waitForClose(10_000);
				return killed === 'timeout'
					? 'Lock holder did not exit after kill'
					: `Lock holder ignored release and was killed (${killed})`;
			};
			let released: number | string | null;
			try {
				let output = '';
				let onData = (_chunk: Buffer) => {};
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					await new Promise<void>((resolve, reject) => {
						onData = (chunk) => {
							output += chunk.toString();
							if (output.includes('LOCKED')) resolve();
						};
						locker.stdout.on('data', onData);
						locker.stderr.on('data', onData);
						timer = setTimeout(() => reject(new Error(`Lock not acquired: ${output}`)), 30_000);
						void closed.then((code) =>
							reject(
								spawnError ?? new Error(`Lock holder exited with ${code} before locking: ${output}`)
							)
						);
					});
				} finally {
					clearTimeout(timer);
					locker.stdout.off('data', onData);
					locker.stderr.off('data', onData);
				}

				const failed = runSetup(dir, [...REQUIRED, ...IDENTITY]);
				expect(failed.code).not.toBe(0);
				expect(failed.stdout).not.toContain('Setup complete.');
				expect(failed.stderr).toMatch(/EBUSY|EPERM|EACCES/);
				const pkg = JSON.parse(readFileSync(at(dir, 'package.json'), 'utf8'));
				expect(pkg.name).toBe('northwind-labs');
				expect(pkg.scripts).not.toHaveProperty('install:cli');
				expect(readFileSync(at(dir, 'src/lib/config/legal.ts'), 'utf8')).toContain(
					"brandName: 'Northwind Labs'"
				);
				expect(existsSync(at(dir, workflow))).toBe(false);
				expect(existsSync(locked)).toBe(true);
			} finally {
				released = await release();
			}
			expect(released).toBe(0);

			const retry = runSetup(dir, []);
			expect(retry.code, retry.stderr).toBe(0);
			expect(retry.stdout).toContain('Setup complete.');
			expect(existsSync(at(dir, child))).toBe(false);
			expect(readFileSync(at(dir, 'packages/neighbor/keep.txt'), 'utf8')).toBe('neighbor');
		},
		120_000
	);

	it.each([
		{ target: '.github/workflows/create-saas-starter.yml', type: 'file' as const },
		{ target: 'packages/create-saas-starter', type: 'dir' as const }
	])('rejects a linked $target before canonical writes', ({ target, type }) => {
		const dir = createFixture(layout);
		const leaf = at(dir, target);
		rmSync(leaf, { recursive: true });
		symlinkSync(
			'missing-target',
			leaf,
			process.platform === 'win32' && type === 'dir' ? 'junction' : type
		);
		const before = snapshot(dir);
		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/redirected or invalid/);
		expect(snapshot(dir)).toEqual(before);
	});

	it('does not traverse a linked child descendant during deletion', () => {
		const dir = createFixture(layout);
		const outside = mkdtempSync(join(tmpdir(), 'setup-linked-descendant-'));
		fixtures.push(outside);
		writeFileSync(join(outside, 'keep.txt'), 'outside');
		symlinkSync(
			outside,
			at(dir, 'packages/create-saas-starter/external'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('outside');
	});

	it('rejects a workflow with multiple hard links before writing', () => {
		const dir = createFixture(layout);
		const workflow = at(dir, '.github/workflows/create-saas-starter.yml');
		const peer = at(dir, '.github/workflows/peer.yml');
		linkSync(workflow, peer);
		const before = snapshot(dir);
		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/invalid file target/);
		expect(snapshot(dir)).toEqual(before);
		expect(readFileSync(peer, 'utf8')).toBe('name: creator\n');
	});

	it.each([
		{ target: 'packages', type: 'dir' as const },
		{ target: '.github/workflows', type: 'file' as const }
	])('rejects a redirected $target before canonical writes', ({ target, type }) => {
		const dir = createFixture(layout);
		const outside = mkdtempSync(join(tmpdir(), 'setup-outside-'));
		fixtures.push(outside);
		const old = at(dir, target);
		cpSync(old, outside, { recursive: true });
		rmSync(old, { recursive: true });
		mkdirSync(join(outside, type === 'file' ? '' : 'create-saas-starter'), { recursive: true });
		if (type === 'file') writeFileSync(join(outside, 'create-saas-starter.yml'), 'outside');
		symlinkSync(outside, old, process.platform === 'win32' ? 'junction' : 'dir');
		const before = snapshot(dir);
		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(
			layout.name === 'workspace' && target === 'packages'
				? /Refusing packages\/product-config\/src\/config\/site\.ts: real parent is outside the repository root/
				: /redirected or invalid parent/
		);
		expect(snapshot(dir)).toEqual(before);
		expect(
			existsSync(join(outside, type === 'file' ? 'create-saas-starter.yml' : 'create-saas-starter'))
		).toBe(true);
	});
});

describe.each(LAYOUTS)('template setup manifest preflight in the $name tree', (layout) => {
	it.each([
		{
			label: 'a moved install command',
			mutate: (scripts: Record<string, string>) => {
				scripts.postinstall =
					required(scripts.postinstall, 'postinstall script').replace(
						'bun run install:cli && ',
						''
					) + ' && bun run install:cli';
			}
		},
		{
			label: 'a duplicate test command',
			mutate: (scripts: Record<string, string>) => {
				scripts.test += ' && bun run test:cli';
			}
		},
		{
			label: 'a missing creator script',
			mutate: (scripts: Record<string, string>) => {
				delete scripts['build:cli'];
			}
		},
		{
			label: 'an unexpected creator reference',
			mutate: (scripts: Record<string, string>) => {
				scripts.custom = 'bun run check:cli';
			}
		},
		{
			label: 'a quoted extra test invocation',
			mutate: (scripts: Record<string, string>) => {
				scripts.test += ' && bun run "test:cli"';
			}
		},
		{
			label: 'a quoted wrapper script',
			mutate: (scripts: Record<string, string>) => {
				scripts['retry-cli'] = "bun run 'test:cli'";
			}
		},
		{
			label: 'a shorthand invocation',
			mutate: (scripts: Record<string, string>) => {
				scripts.test += ' && bun test:cli';
			}
		},
		{
			label: 'a split-quoted child directory',
			mutate: (scripts: Record<string, string>) => {
				scripts['retry-cli'] = 'bun run --cwd packages/"create-saas-starter" build';
			}
		},
		{
			label: 'a split-quoted child suffix',
			mutate: (scripts: Record<string, string>) => {
				scripts['retry-cli'] = 'bun run --cwd packages/create-saas-"starter" build';
			}
		}
	])('rejects $label before canonical writes', ({ mutate }) => {
		const dir = createFixture(layout);
		const file = at(dir, 'package.json');
		const manifest = JSON.parse(readFileSync(file, 'utf8'));
		mutate(manifest.scripts);
		writeFileSync(file, JSON.stringify(manifest, null, '\t') + '\n');
		const before = snapshot(dir);
		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/Invalid package.json/);
		expect(run.stdout).not.toContain('Applying:');
		expect(snapshot(dir)).toEqual(before);
		expect(existsSync(at(dir, '.github/workflows/create-saas-starter.yml'))).toBe(true);
		expect(existsSync(at(dir, 'packages/create-saas-starter/package.json'))).toBe(true);
	});

	it.each(['test:cli:app', 'test:cli-app'])(
		'keeps the distinct custom script %s across setup and rerun',
		(name) => {
			const dir = createFixture(layout);
			const file = at(dir, 'package.json');
			const manifest = JSON.parse(readFileSync(file, 'utf8'));
			manifest.scripts[name] = 'echo app';
			manifest.scripts.custom = `bun run ${name}`;
			writeFileSync(file, JSON.stringify(manifest, null, '\t') + '\n');

			const first = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(first.code, first.stderr).toBe(0);
			const scripts = JSON.parse(readFileSync(file, 'utf8')).scripts;
			expect(scripts[name]).toBe('echo app');
			expect(scripts.custom).toBe(`bun run ${name}`);
			expect(scripts).not.toHaveProperty('test:cli');
			expect(existsSync(at(dir, 'packages/create-saas-starter'))).toBe(false);

			const after = snapshot(dir);
			const rerun = runSetup(dir, []);
			expect(rerun.code, rerun.stderr).toBe(0);
			expect(snapshot(dir)).toEqual(after);
		}
	);

	it.each(['echo test:cli', 'printf test:cli'])(
		'keeps the printed label in %s across setup and rerun',
		(command) => {
			const dir = createFixture(layout);
			const file = at(dir, 'package.json');
			const manifest = JSON.parse(readFileSync(file, 'utf8'));
			manifest.scripts.custom = command;
			writeFileSync(file, JSON.stringify(manifest, null, '\t') + '\n');

			const first = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(first.code, first.stderr).toBe(0);
			const scripts = JSON.parse(readFileSync(file, 'utf8')).scripts;
			expect(scripts.custom).toBe(command);
			expect(scripts).not.toHaveProperty('test:cli');
			expect(existsSync(at(dir, 'packages/create-saas-starter'))).toBe(false);

			const after = snapshot(dir);
			const rerun = runSetup(dir, []);
			expect(rerun.code, rerun.stderr).toBe(0);
			expect(snapshot(dir)).toEqual(after);
		}
	);
});

describe.each(LAYOUTS)('template setup re-runs in the $name tree', (layout) => {
	it('preserves the configured identity without identity flags', () => {
		const dir = createFixture(layout);
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
		const afterFirst = snapshot(dir);

		const rerun = runSetup(dir, REQUIRED);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(afterFirst);
	});

	it('preserves a literal single delimiter across a flagless re-run', () => {
		const dir = createFixture(layout);
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
		const dir = createFixture(layout);
		const preload = at(dir, 'fail-legal-write.mjs');
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
		const dir = createFixture(layout);
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY.slice(2), '--brand', 'SaaS Starter']).code).toBe(
			0
		);
		const afterFirst = snapshot(dir);

		// The explicitly chosen name takes precedence over titleCase('northwind-labs').
		const rerun = runSetup(dir, REQUIRED);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(afterFirst);
		expect(readFileSync(at(dir, 'src/lib/config/legal.ts'), 'utf-8')).toContain(
			"brandName: 'SaaS Starter'"
		);
	});

	it('rewrites the quick start again after the repository is renamed', () => {
		const dir = createFixture(layout);
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
		const renamed = runSetup(dir, [
			'--slug',
			'northwind-cloud',
			'--repo',
			'northwind/northwind-cloud'
		]);
		expect(renamed.code, renamed.stderr).toBe(0);

		const readme = readFileSync(at(dir, 'README.md'), 'utf-8');
		expect(readme).toContain('git clone https://github.com/northwind/northwind-cloud.git');
		expect(readme).toContain('cd ./northwind-cloud');
		expect(readme).not.toContain('northwind-labs');
	});
});

describe.each(LAYOUTS)('template setup first run identity in the $name tree', (layout) => {
	it('writes none of the template legal identity without identity flags', () => {
		const dir = createFixture(layout);
		cpSync(join(ROOT, 'src/lib/config/legal.ts'), at(dir, 'src/lib/config/legal.ts'));
		const template = required(importLegalConfig(dir).value, 'template legal config');

		const run = runSetup(dir, [...REQUIRED, '--brand', 'Northwind Labs']);
		expect(run.code, run.stderr).toBe(0);

		const project = required(importLegalConfig(dir).value, 'project legal config');
		expect(project.identity.operatorName).not.toBe(template.identity.operatorName);
		for (const key of ['streetAddress', 'postalCode', 'addressLocality'] as const) {
			expect(project.identity.address[key], key).not.toBe(template.identity.address[key]);
		}
		expect(project.mailto).not.toBe(template.mailto);
	});

	it('keeps a configured identity when the README no longer shows the setup', () => {
		const dir = createFixture(layout);
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
		const configured = required(importLegalConfig(dir).value, 'configured legal config');
		const readme = at(dir, 'README.md');
		writeFileSync(readme, readFileSync(readme, 'utf-8').replace(/^# .*$/m, '# Northwind'));

		const rerun = runSetup(dir, ['--slug', 'northwind-cloud', '--brand', 'Northwind Labs']);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(required(importLegalConfig(dir).value, 'rerun legal config').identity).toEqual(
			configured.identity
		);
	});
});

describe.each(LAYOUTS)(
	'template setup records the creation fork point in the $name tree',
	(layout) => {
		const GIT_ENV: NodeJS.ProcessEnv = {
			...CHILD_ENV,
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
			GIT_AUTHOR_NAME: 'Fixture',
			GIT_AUTHOR_EMAIL: 'fixture@example.com',
			GIT_COMMITTER_NAME: 'Fixture',
			GIT_COMMITTER_EMAIL: 'fixture@example.com'
		};
		function git(dir: string, args: string[]): string {
			const result = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', env: GIT_ENV });
			if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
			return result.stdout.trim();
		}
		function committedFixture(files: Record<string, string> = {}): { dir: string; head: string } {
			const dir = createFixture(layout);
			// Inside Git, setup reads the scaffold marker through the upstream-sync skill's helper.
			const helper = '.agents/skills/upstream-sync/scripts/scaffold-marker.ts';
			mkdirSync(dirname(at(dir, helper)), { recursive: true });
			cpSync(join(ROOT, helper), at(dir, helper));
			for (const [rel, content] of Object.entries(files)) writeFileSync(at(dir, rel), content);
			git(dir, ['init', '-q', '-b', 'main']);
			git(dir, ['add', '-A']);
			git(dir, ['commit', '-q', '--no-verify', '-m', 'fixture']);
			return { dir, head: git(dir, ['rev-parse', 'HEAD']) };
		}
		function recorded(dir: string): unknown {
			const path = at(dir, '.upstream-sync.json');
			return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : undefined;
		}

		it('records the CLI scaffold sha and keeps it on a re-run', () => {
			const dir = createFixture(layout);
			const sha = 'a'.repeat(40);
			const scaffold = at(dir, '.saas-starter-scaffold.json');
			writeFileSync(scaffold, JSON.stringify({ source: 'stickerdaniel/saas-starter', sha }));
			const first = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(first.code, first.stderr).toBe(0);
			expect(recorded(dir)).toEqual({ forkPoint: sha });

			writeFileSync(
				scaffold,
				JSON.stringify({ source: 'stickerdaniel/saas-starter', sha: 'b'.repeat(40) })
			);
			const rerun = runSetup(dir, []);
			expect(rerun.code, rerun.stderr).toBe(0);
			expect(recorded(dir)).toEqual({ forkPoint: sha });
		});

		it('records HEAD of a clone that still sits on an upstream ref', () => {
			const { dir, head } = committedFixture();
			git(dir, ['update-ref', 'refs/remotes/upstream/main', head]);
			const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(run.code, run.stderr).toBe(0);
			expect(recorded(dir)).toEqual({ forkPoint: head });
		});

		it('records the committed scaffold sha when the working-tree marker was edited', () => {
			const original = 'c'.repeat(40);
			const scaffold = (sha: string) =>
				JSON.stringify({ source: 'stickerdaniel/saas-starter', sha });
			const { dir } = committedFixture({ '.saas-starter-scaffold.json': scaffold(original) });
			writeFileSync(at(dir, '.saas-starter-scaffold.json'), scaffold('d'.repeat(40)));
			const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(run.code, run.stderr).toBe(0);
			expect(recorded(dir)).toEqual({ forkPoint: original });
		});

		it('records nothing for a template copy whose bootstrap commit is not upstream', () => {
			const { dir } = committedFixture();
			const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(run.code, run.stderr).toBe(0);
			expect(recorded(dir)).toBeUndefined();
		});
	}
);

describe.each(LAYOUTS)('template setup legal dates module in the $name tree', (layout) => {
	it('dates every legal page with the setup date', () => {
		const dir = createFixture(layout);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const dates = legalDates(dir);
		expect(dates).toHaveLength(3);
		expect(new Set(dates).size).toBe(1);
		expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(run.stdout).toContain(`updated legal-content-dates.ts (Last Updated: ${dates[0]})`);
	});
});

describe.each(LAYOUTS)('template setup quick start in the $name tree', (layout) => {
	it('replaces the template instructions with the generated project setup', () => {
		const dir = createFixture(layout);
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);

		const readme = readFileSync(at(dir, 'README.md'), 'utf-8');
		expect(readme.split('\n')[0]).toBe('# Northwind Labs');
		expect(readme).toContain(
			'seeded admin account.\n\n```bash\ngit clone https://github.com/northwind/northwind-labs.git\ncd ./northwind-labs\nbun install\nbun run dev\n```'
		);
		expect(readme).not.toContain('gh repo create');
		expect(readme).not.toContain('my-saas-product');
		expect(readme).not.toContain('Live demo!');
		// A generated project neither creates itself again nor links the removed CLI package.
		expect(readme).not.toContain('create saas-starter');
		expect(readme).not.toContain('packages/create-saas-starter');
		expect(readme).not.toContain('template-only');
		// Unrelated prose remains unchanged.
		expect(readme).toContain('## Why This Exists');
	});

	it('keeps links to prefix-related repositories byte-identical', () => {
		const dir = createFixture(layout);
		const readme = at(dir, 'README.md');
		const relatedLink = 'https://github.com/stickerdaniel/saas-starter-tools/issues/1';
		writeFileSync(readme, `${readFileSync(readme, 'utf-8')}\n${relatedLink}\n`, 'utf-8');

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const updated = readFileSync(readme, 'utf-8');
		expect(updated).toContain(relatedLink);
		expect(updated).toContain('https://github.com/northwind/northwind-labs/actions');
	});

	it('writes a literal strikethrough-looking brand and recognizes the end state', () => {
		const dir = createFixture(layout);
		const run = runSetup(dir, [...REQUIRED, ...IDENTITY, '--brand', '~~Northwind~~']);
		expect(run.code, run.stderr).toBe(0);
		const afterFirst = snapshot(dir);
		expect(required(afterFirst['README.md'], 'README.md').split('\n')[0]).toBe(
			'# \\~\\~Northwind\\~\\~'
		);

		const rerun = runSetup(dir, []);
		expect(rerun.code, rerun.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(afterFirst);
	});

	it('uses an option-safe directory for a repository basename starting with a hyphen', () => {
		const dir = createFixture(layout);
		const run = runSetup(dir, [
			'--slug',
			'northwind-project',
			'--repo',
			'northwind/-project',
			...IDENTITY
		]);
		expect(run.code, run.stderr).toBe(0);
		expect(readFileSync(at(dir, 'README.md'), 'utf-8')).toContain(
			'git clone https://github.com/northwind/-project.git\ncd ./-project\n'
		);
	});

	it('keeps a foreign fenced demo while removing the template paragraph', () => {
		const dir = createFixture(layout);
		const readme = at(dir, 'README.md');
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
		const dir = createFixture(layout);
		const readme = at(dir, 'README.md');
		writeFileSync(readme, readFileSync(readme, 'utf-8').replace(/\n/g, '\r\n'), 'utf-8');

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const updated = readFileSync(readme, 'utf-8');
		expect(updated).not.toContain('Live demo!');
		expect(updated).not.toMatch(/[^\r]\n/);
	});

	it('keeps the root name in manifest and lockfile in sync', () => {
		const dir = createFixture(layout);
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);

		const pkg = JSON.parse(readFileSync(at(dir, 'package.json'), 'utf-8'));
		const lock = readFileSync(at(dir, 'bun.lock'), 'utf-8');
		expect(pkg.name).toBe('northwind-labs');
		expect(/"workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"([^"]*)"/.exec(lock)?.[1]).toBe(
			'northwind-labs'
		);
		// Only the root name changes; the dependency graph remains byte-identical.
		expect(lock).toBe(
			readFileSync(join(ROOT, 'scripts/__fixtures__/template-setup/bun.lock'), 'utf-8').replace(
				'"name": "saas-starter"',
				'"name": "northwind-labs"'
			)
		);
	});

	it('keeps environment worker names byte-identical', () => {
		const dir = createFixture(layout);
		const wrangler = at(dir, 'wrangler.toml');
		const environment = '\n[env.staging]\nname = "staging-worker" # keep me\n';
		writeFileSync(wrangler, readFileSync(wrangler, 'utf-8') + environment, 'utf-8');

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(run.code, run.stderr).toBe(0);
		const updated = readFileSync(wrangler, 'utf-8');
		expect(updated).toMatch(/^name = "northwind-labs"/m);
		expect(updated.endsWith(environment)).toBe(true);
	});

	it('ignores root-looking syntax inside multiline TOML strings', () => {
		const dir = createFixture(layout);
		const wrangler = at(dir, 'wrangler.toml');
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

describe.each(LAYOUTS)(
	'template setup finds the runtime repository property in the $name tree',
	(layout) => {
		it('ignores comments, strings, and interface signatures around SITE_CONFIG', () => {
			const dir = createFixture(layout);
			const site = at(dir, 'src/lib/config/site.ts');
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
	}
);

describe.each(LAYOUTS)(
	'template setup rejects input before writing in the $name tree',
	(layout) => {
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
			const dir = createFixture(layout);
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
				malformed: (source: string) => !source.includes("githubSlug: '"),
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
				malformed: (source: string) => source.match(/^\tgithubSlug: '[^']*',$/gm)?.length === 2,
				expected: /Expected exactly one direct githubSlug property/
			},
			{
				label: 'the site config uses a non-literal githubSlug value',
				file: 'src/lib/config/site.ts',
				mutate: (source: string) =>
					source.replace("githubSlug: 'stickerdaniel/saas-starter'", 'githubSlug: repository'),
				malformed: (source: string) =>
					source.includes('\tgithubSlug: repository,') && !source.includes("githubSlug: '"),
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
				malformed: (source: string) =>
					source.includes("export const LEGAL_CONFIG = { brandName: 'X' };") &&
					!source.includes('} as const;'),
				expected: /LEGAL_CONFIG must use a direct object initializer/
			},
			{
				label: 'the README lost its quick start',
				file: 'README.md',
				mutate: () => '# Custom Title\n\nUnrelated prose.\n',
				malformed: (source: string) => !/^## Quick Start/m.test(source),
				expected: /Expected exactly one Quick Start H2/
			},
			{
				label: 'wrangler.toml lost its name assignment',
				file: 'wrangler.toml',
				mutate: (source: string) => source.replace(/^name = "[^"]*".*\n/m, ''),
				malformed: (source: string) => !/^name = /m.test(source),
				expected: /Expected exactly one name assignment/
			},
			{
				label: 'wrangler.toml uses a multiline basic string for the root name',
				file: 'wrangler.toml',
				mutate: (source: string) =>
					source.replace(/^name = "[^"]*".*$/m, 'name = """base-worker"""'),
				malformed: (source: string) => /^name = """base-worker"""$/m.test(source),
				expected: /Expected exactly one name assignment/
			},
			{
				label: 'wrangler.toml uses a multiline literal string for the root name',
				file: 'wrangler.toml',
				mutate: (source: string) =>
					source.replace(/^name = "[^"]*".*$/m, "name = '''base-worker'''"),
				malformed: (source: string) => /^name = '''base-worker'''$/m.test(source),
				expected: /Expected exactly one name assignment/
			}
		])('leaves every file untouched when $label', ({ file, mutate, malformed, expected }) => {
			const dir = createFixture(layout);
			const original = readFileSync(at(dir, file), 'utf-8');
			const mutated = mutate(original);
			expect(mutated).not.toBe(original);
			expect(malformed(original)).toBe(false);
			expect(malformed(mutated)).toBe(true);
			writeFileSync(at(dir, file), mutated, 'utf-8');
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
			const dir = createFixture(layout);
			const legal = at(dir, 'src/lib/config/legal.ts');
			const original = readFileSync(legal, 'utf-8');
			const mutated = mutate(original);
			const unsupportedFirstProperty =
				/^export const LEGAL_CONFIG = \{\n\t(?:unsupported|\['__proto__'\]):/m;
			expect(mutated).not.toBe(original);
			expect(original).not.toMatch(unsupportedFirstProperty);
			expect(mutated).toMatch(unsupportedFirstProperty);
			writeFileSync(legal, mutated, 'utf-8');
			const before = snapshot(dir);

			const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(run.code).toBe(1);
			expect(run.stderr).toMatch(/Unsupported LEGAL_CONFIG/);
			expect(snapshot(dir)).toEqual(before);
		});
	}
);

describe.each(LAYOUTS)(
	'template setup recognizes a genuinely set up project in the $name tree',
	(layout) => {
		// A hand-edited package name or githubSlug does not prove setup while Quick Start is bootstrap.
		it.each([
			{
				label: 'only the package name was renamed by hand',
				mutate: (dir: string) => {
					const pkg = JSON.parse(readFileSync(at(dir, 'package.json'), 'utf-8'));
					pkg.name = 'renamed-by-hand';
					writeFileSync(at(dir, 'package.json'), JSON.stringify(pkg, null, '\t') + '\n', 'utf-8');
				}
			},
			{
				label: 'the package name and the githubSlug were edited by hand',
				mutate: (dir: string) => {
					const pkg = JSON.parse(readFileSync(at(dir, 'package.json'), 'utf-8'));
					pkg.name = 'renamed-by-hand';
					writeFileSync(at(dir, 'package.json'), JSON.stringify(pkg, null, '\t') + '\n', 'utf-8');
					const site = at(dir, 'src/lib/config/site.ts');
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
			const dir = createFixture(layout);
			mutate(dir);
			const before = snapshot(dir);

			const run = runSetup(dir, [
				'--slug',
				'renamed-by-hand',
				'--repo',
				'northwind/northwind-labs'
			]);
			expect(run.code).toBe(1);
			expect(run.stderr).toMatch(/Missing: --brand/);
			expect(snapshot(dir)).toEqual(before);
		});

		it('rejects a flagless run when only githubSlug and the clone block were edited', () => {
			const dir = createFixture(layout);
			const site = at(dir, 'src/lib/config/site.ts');
			writeFileSync(
				site,
				readFileSync(site, 'utf-8').replace(
					"githubSlug: 'stickerdaniel/saas-starter'",
					"githubSlug: 'northwind/northwind-labs'"
				),
				'utf-8'
			);
			const readme = at(dir, 'README.md');
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
			const dir = createFixture(layout);
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
			const dir = createFixture(layout);
			expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
			const readme = at(dir, 'README.md');
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
			const dir = createFixture(layout);
			expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
			const readme = at(dir, 'README.md');
			writeFileSync(readme, readFileSync(readme, 'utf-8').replace(/\n/g, '\r\n'), 'utf-8');
			const afterFirst = snapshot(dir);

			const rerun = runSetup(dir, []);
			expect(rerun.code, rerun.stderr).toBe(0);
			expect(snapshot(dir)).toEqual(afterFirst);
			expect(readFileSync(readme, 'utf-8')).toContain('\r\n');
		});

		it('keeps an existing empty company name instead of deriving one', () => {
			const dir = createFixture(layout);
			const legal = at(dir, 'src/lib/config/legal.ts');
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
			const dir = createFixture(layout);
			const legal = at(dir, 'src/lib/config/legal.ts');
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
	}
);

const LEGAL_DATES = 'src/lib/content/legal-content-dates.ts';
const OLD_LEGAL_DATE = '2025-01-02';

/** Backdates the three legal dates so a later run shows whether it rewrote them. */
function backdateLegalDates(dir: string): void {
	const dates = at(dir, LEGAL_DATES);
	writeFileSync(
		dates,
		readFileSync(dates, 'utf-8').replace(
			/^(\s*(?:privacy|terms|impressum): )'[^']*'/gm,
			(_match, prefix: string) => `${prefix}'${OLD_LEGAL_DATE}'`
		),
		'utf-8'
	);
}

function legalDates(dir: string): string[] {
	const source = readFileSync(at(dir, LEGAL_DATES), 'utf-8');
	return [...source.matchAll(/^\s*(?:privacy|terms|impressum): '([^']+)'/gm)].map(
		([, date]) => date!
	);
}

/** Replaces the address property in a fixture's legal.ts with the given source text. */
function writeLegalAddress(dir: string, property: string): void {
	const legal = at(dir, 'src/lib/config/legal.ts');
	const source = readFileSync(legal, 'utf-8');
	const updated = source.replace(
		/^\taddress: (?:\{[^}]*\}|'[^']*'),$/m,
		() => `\taddress: ${property},`
	);
	expect(updated).not.toBe(source);
	writeFileSync(legal, updated, 'utf-8');
}

const NORTHWIND_ADDRESS = {
	streetAddress: 'Hauptstrasse 5',
	postalCode: '12345',
	addressLocality: 'Berlin',
	addressCountry: 'DE'
};

describe.each(LAYOUTS)(
	'template setup stores the legal address as fields in the $name tree',
	(layout) => {
		it('writes the four address flags as an importable structured address', () => {
			const dir = createFixture(layout);
			const street = `O'Brien "Hof" 5, c/o Weber`;
			const run = runSetup(dir, [...REQUIRED, ...IDENTITY, '--street', street]);
			expect(run.code, run.stderr).toBe(0);

			const imported = importLegalConfig(dir);
			expect(imported.code, imported.stderr).toBe(0);
			expect(imported.value?.config.address).toEqual({
				...NORTHWIND_ADDRESS,
				streetAddress: street
			});
			expect(imported.value?.address).toBe(`${street}, 12345 Berlin, DE`);
		});

		it('rejects --address with the replacement flags before writing', () => {
			const dir = createFixture(layout);
			const before = snapshot(dir);

			const run = runSetup(dir, [...REQUIRED, ...IDENTITY, '--address', 'Hauptstrasse 5']);
			expect(run.code).toBe(1);
			expect(run.stderr).toContain(
				'--address was replaced by --street, --postal-code, --city, and --country.'
			);
			expect(snapshot(dir)).toEqual(before);
		});

		it.each(['de', 'DEU', 'D1'])('rejects the country %s before writing', (country) => {
			const dir = createFixture(layout);
			const before = snapshot(dir);

			const run = runSetup(dir, [...REQUIRED, ...IDENTITY, '--country', country]);
			expect(run.code).toBe(1);
			expect(run.stderr).toContain(
				`country must be two uppercase letters, such as US or DE, got: ${country}`
			);
			expect(snapshot(dir)).toEqual(before);
		});

		it('keeps deliberately older legal dates on a rerun with the same address', () => {
			const dir = createFixture(layout);
			expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
			backdateLegalDates(dir);
			const afterFirst = snapshot(dir);

			const rerun = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(rerun.code, rerun.stderr).toBe(0);
			expect(snapshot(dir)).toEqual(afterFirst);
			expect(legalDates(dir)).toEqual([OLD_LEGAL_DATE, OLD_LEGAL_DATE, OLD_LEGAL_DATE]);
		});

		it.each([
			{ flag: '--street', key: 'streetAddress', value: 'Hauptstrasse 7' },
			{ flag: '--postal-code', key: 'postalCode', value: '10115' },
			{ flag: '--city', key: 'addressLocality', value: 'Potsdam' },
			{ flag: '--country', key: 'addressCountry', value: 'AT' }
		])('bumps the legal dates when only $flag changes', ({ flag, key, value }) => {
			const dir = createFixture(layout);
			expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
			backdateLegalDates(dir);

			const rerun = runSetup(dir, [flag, value]);
			expect(rerun.code, rerun.stderr).toBe(0);
			const imported = importLegalConfig(dir);
			expect(imported.code, imported.stderr).toBe(0);
			expect(imported.value?.config.address).toEqual({ ...NORTHWIND_ADDRESS, [key]: value });
			const dates = legalDates(dir);
			expect(dates).toHaveLength(3);
			expect(new Set(dates).size).toBe(1);
			expect(dates[0]).not.toBe(OLD_LEGAL_DATE);
			expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});

		it('keeps a fork-owned address key across a field change', () => {
			const dir = createFixture(layout);
			writeLegalAddress(
				dir,
				"{\n\t\tstreetAddress: 'Main 1',\n\t\taddressRegion: 'BE',\n\t\tpostalCode: '1000',\n\t\taddressLocality: 'Brussels',\n\t\taddressCountry: 'BE'\n\t}"
			);

			const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(run.code, run.stderr).toBe(0);
			const imported = importLegalConfig(dir);
			expect(imported.code, imported.stderr).toBe(0);
			expect(imported.value?.config.address).toEqual({ ...NORTHWIND_ADDRESS, addressRegion: 'BE' });
		});

		it.each([
			{
				label: 'a missing field',
				property: "{ streetAddress: 'Main 1', postalCode: '1000', addressLocality: 'Brussels' }"
			},
			{
				label: 'a numeric field',
				property:
					"{ streetAddress: 'Main 1', postalCode: 1000, addressLocality: 'Brussels', addressCountry: 'BE' }"
			},
			{ label: 'a number', property: '42' }
		])('rejects an address with $label before writing', ({ property }) => {
			const dir = createFixture(layout);
			writeLegalAddress(dir, property);
			const before = snapshot(dir);

			const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(run.code).toBe(1);
			expect(run.stderr).toContain('Unsupported LEGAL_CONFIG.address');
			expect(run.stdout).not.toContain('Applying:');
			expect(snapshot(dir)).toEqual(before);
		});
	}
);

describe.each(LAYOUTS)(
	'template setup migrates a legacy address string in the $name tree',
	(layout) => {
		/** A template copy whose legal.ts keeps the current helpers but a pre-migration string address. */
		function legacyFixture(): string {
			const dir = createFixture(layout);
			writeLegalAddress(dir, "'123 Main Street, Suite 100, San Francisco, CA 94102'");
			return dir;
		}

		it('rejects a legal module without formatPostalAddress and writes nothing', () => {
			const dir = createFixture(layout);
			cpSync(
				join(ROOT, 'scripts/__fixtures__/template-setup/legacy-string-legal.ts'),
				at(dir, 'src/lib/config/legal.ts')
			);
			const before = snapshot(dir);

			const run = runSetup(dir, [...REQUIRED, ...IDENTITY]);
			expect(run.code).toBe(1);
			expect(run.stderr).toContain('does not export formatPostalAddress');
			expect(run.stdout).not.toContain('Applying:');
			expect(snapshot(dir)).toEqual(before);
		});

		it('requires every address flag without a TTY and writes nothing', () => {
			const dir = legacyFixture();
			const before = snapshot(dir);

			const run = runSetup(dir, [...REQUIRED, ...IDENTITY.slice(0, 6), '--street', 'Main 1']);
			expect(run.code).toBe(1);
			expect(run.stdout).toContain('  123 Main Street, Suite 100, San Francisco, CA 94102');
			expect(run.stderr).toContain('Missing: --postal-code, --city, --country');
			expect(run.stdout).not.toContain('Applying:');
			expect(snapshot(dir)).toEqual(before);
		});

		it('validates the replacement fields before writing', () => {
			const dir = legacyFixture();
			const before = snapshot(dir);

			const run = runSetup(dir, [...REQUIRED, ...IDENTITY, '--country', 'Germany']);
			expect(run.code).toBe(1);
			expect(run.stderr).toContain('country must be two uppercase letters');
			expect(snapshot(dir)).toEqual(before);
		});

		it('migrates a branded fork once and leaves the next rerun unchanged', () => {
			const dir = createFixture(layout);
			expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
			// A fork branded by the previous setup stored a free-form, possibly multiline string.
			writeLegalAddress(dir, "'Hauptstrasse 5\\n12345 Berlin\\nDeutschland'");
			backdateLegalDates(dir);
			const legacy = snapshot(dir);

			const flagless = runSetup(dir, []);
			expect(flagless.code).toBe(1);
			expect(flagless.stdout).toContain('  Hauptstrasse 5\n  12345 Berlin\n  Deutschland\n');
			expect(flagless.stderr).toContain('Missing: --street, --postal-code, --city, --country');
			expect(snapshot(dir)).toEqual(legacy);

			const migrated = runSetup(dir, ADDRESS);
			expect(migrated.code, migrated.stderr).toBe(0);
			const imported = importLegalConfig(dir);
			expect(imported.code, imported.stderr).toBe(0);
			expect(imported.value?.config).toMatchObject({
				brandName: 'Northwind Labs',
				companyName: 'Northwind Labs GmbH',
				operatorName: 'Anne Weber',
				address: NORTHWIND_ADDRESS
			});
			expect(imported.value?.mailto).toBe('kontakt@northwind-labs.de');
			expect(legalDates(dir)[0]).not.toBe(OLD_LEGAL_DATE);
			const afterMigration = snapshot(dir);
			expect(afterMigration['README.md']).toBe(legacy['README.md']);

			const rerun = runSetup(dir, []);
			expect(rerun.code, rerun.stderr).toBe(0);
			expect(rerun.stdout).not.toContain('single string');
			expect(snapshot(dir)).toEqual(afterMigration);
		});
	}
);

describe.each(LAYOUTS)(
	'template setup keeps prose values on one line in the $name tree',
	(layout) => {
		const multiline = 'Northwind Labs\n\n## Injected Heading\n\nmore text';

		// Brand and operator enter Privacy and Terms paragraphs as raw text.
		it.each([
			{ flag: '--brand', expected: /brand must be a single line/ },
			{ flag: '--operator', expected: /operator must be a single line/ }
		])('rejects a multi-line $flag before writing', ({ flag, expected }) => {
			const dir = createFixture(layout);
			const before = snapshot(dir);

			const run = runSetup(dir, [...REQUIRED, ...IDENTITY, flag, multiline]);
			expect(run.code).toBe(1);
			expect(run.stderr).toMatch(expected);
			expect(snapshot(dir)).toEqual(before);
		});

		it.each(['--street', '--postal-code', '--city'])(
			'rejects a multi-line %s before writing',
			(flag) => {
				const dir = createFixture(layout);
				const before = snapshot(dir);

				const run = runSetup(dir, [...REQUIRED, ...IDENTITY, flag, 'Line 1\nLine 2']);
				expect(run.code).toBe(1);
				expect(run.stderr).toContain(`${flag.slice(2)} must be a single line`);
				expect(snapshot(dir)).toEqual(before);
			}
		);
	}
);

describe.each(LAYOUTS)('template setup contact email end to end in the $name tree', (layout) => {
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
		const dir = createFixture(layout);
		const before = snapshot(dir);

		const run = runSetup(dir, [...REQUIRED, ...IDENTITY.slice(0, 6), '--email', value]);
		expect(run.code).toBe(1);
		expect(run.stderr).toMatch(/email must use the consumer-compatible user@domain\.tld subset/);
		expect(snapshot(dir)).toEqual(before);
	});

	it('keeps plus, apostrophe, and Unicode in the supported subset', () => {
		const dir = createFixture(layout);
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
		const dir = createFixture(layout);
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

describe.each(LAYOUTS)(
	'template setup atomic single-file replacements in the $name tree',
	(layout) => {
		it.each(
			SINGLE_REPLACE_OUTPUTS.flatMap((target) =>
				SINGLE_REPLACE_FAULTS.map((phase) => ({ target, phase }))
			)
		)('keeps $target whole after a $phase fault and converges on retry', ({ target, phase }) => {
			const expectedDir = createFixture(layout);
			const expectedRun = runSetup(expectedDir, [...REQUIRED, ...IDENTITY]);
			expect(expectedRun.code, expectedRun.stderr).toBe(0);
			const expected = snapshot(expectedDir);

			const dir = createFixture(layout);
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
			const dir = createFixture(layout);
			const fault = createFaultPreload(dir, {
				phase: 'single-cleanup-rmdir',
				target: 'src/lib/config/site.ts'
			});
			const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);
			expectFault(failed, fault, 'rmdirSync');
			expect(readFileSync(at(dir, 'README.md'), 'utf-8')).toContain(
				'git clone https://github.com/northwind/northwind-labs.git'
			);
			expect(readFileSync(at(dir, 'src/lib/config/site.ts'), 'utf-8')).toContain(
				"githubSlug: 'northwind/northwind-labs'"
			);

			const retry = runSetup(dir, []);
			expect(retry.code, retry.stderr).toBe(0);
		});
	}
);

const LEGAL_OUTPUTS = [
	'src/lib/config/legal.ts',
	'src/lib/content/legal-content-dates.ts'
] as const;

function setLegalModes(dir: string): { config: number; dates: number } {
	chmodSync(at(dir, LEGAL_OUTPUTS[0]), 0o640);
	chmodSync(at(dir, LEGAL_OUTPUTS[1]), 0o604);
	const modes = { config: mode(dir, LEGAL_OUTPUTS[0]), dates: mode(dir, LEGAL_OUTPUTS[1]) };
	if (process.platform !== 'win32') expect(modes.config).not.toBe(modes.dates);
	return modes;
}

const LEGAL_PREPARE_FAULTS = ['write', 'partial-write', 'chmod'] as const;

describe.each(LAYOUTS)('template setup legal pair commit protocol in the $name tree', (layout) => {
	it.each(
		LEGAL_OUTPUTS.flatMap((target) => LEGAL_PREPARE_FAULTS.map((phase) => ({ target, phase })))
	)('leaves the original pair after a $phase fault for $target', ({ target, phase }) => {
		const expectedDir = createFixture(layout);
		setLegalModes(expectedDir);
		const expectedRun = runSetup(expectedDir, [...REQUIRED, ...IDENTITY]);
		expect(expectedRun.code, expectedRun.stderr).toBe(0);
		const expected = snapshot(expectedDir);

		const dir = createFixture(layout);
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
		expect(mode(dir, LEGAL_OUTPUTS[1])).toBe(originalModes.dates);

		const retry = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(retry.code, retry.stderr).toBe(0);
		expect(snapshot(dir)).toEqual(expected);
		expect(mode(dir, LEGAL_OUTPUTS[0])).toBe(originalModes.config);
		expect(mode(dir, LEGAL_OUTPUTS[1])).toBe(originalModes.dates);
	});

	it.each([
		{ phase: 'legal-backup' as const, operation: 'renameSync' },
		{ phase: 'legal-config-install' as const, operation: 'renameSync' },
		{ phase: 'legal-dates-install' as const, operation: 'renameSync' }
	])('restores the original pair after $phase fails before commit', ({ phase, operation }) => {
		const dir = createFixture(layout);
		const originalModes = setLegalModes(dir);
		const before = snapshot(dir);
		const fault = createFaultPreload(dir, { phase, target: LEGAL_OUTPUTS[0] });
		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);
		expectFault(failed, fault, operation);
		expect(snapshot(dir)).toEqual(before);
		expect(mode(dir, LEGAL_OUTPUTS[0])).toBe(originalModes.config);
		expect(mode(dir, LEGAL_OUTPUTS[1])).toBe(originalModes.dates);

		const retry = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(retry.code, retry.stderr).toBe(0);
	});

	it('preserves the backup and recovery file when restoring the config fails', () => {
		const dir = createFixture(layout);
		const beforeConfig = readFileSync(at(dir, LEGAL_OUTPUTS[0]));
		const beforeDates = readFileSync(at(dir, LEGAL_OUTPUTS[1]));
		const fault = createFaultPreload(dir, {
			phase: 'legal-dates-and-restore',
			target: LEGAL_OUTPUTS[0]
		});
		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);

		expect(failed.code).toBe(1);
		expect(failed.stderr).toContain(`FAULT_HIT ${fault.id} operation=renameSync`);
		expect(failed.stderr).toContain(`FAULT_HIT ${fault.id} operation=renameSync-restore`);
		expect(failed.stderr).toContain('template-setup.ts');
		expect(failed.stderr).toMatch(/Recovery required/);
		expect(failed.stderr).toMatch(/legal\.ts\.backup/);
		expect(failed.stderr).toMatch(/canonical config=.*canonical dates=/);
		expect(existsSync(at(dir, LEGAL_OUTPUTS[0]))).toBe(false);
		expect(readFileSync(at(dir, LEGAL_OUTPUTS[1]))).toEqual(beforeDates);

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
		const expectedDir = createFixture(layout);
		setLegalModes(expectedDir);
		expect(runSetup(expectedDir, [...REQUIRED, ...IDENTITY]).code).toBe(0);
		const expectedConfig = readFileSync(at(expectedDir, LEGAL_OUTPUTS[0]));
		const expectedDates = readFileSync(at(expectedDir, LEGAL_OUTPUTS[1]));

		const dir = createFixture(layout);
		const originalModes = setLegalModes(dir);
		const fault = createFaultPreload(dir, { phase, target: LEGAL_OUTPUTS[0] });
		const failed = runSetup(dir, [...REQUIRED, ...IDENTITY], fault.path);
		expectFault(failed, fault, operation);
		expect(readFileSync(at(dir, LEGAL_OUTPUTS[0]))).toEqual(expectedConfig);
		expect(readFileSync(at(dir, LEGAL_OUTPUTS[1]))).toEqual(expectedDates);
		expect(mode(dir, LEGAL_OUTPUTS[0])).toBe(originalModes.config);
		expect(mode(dir, LEGAL_OUTPUTS[1])).toBe(originalModes.dates);
		expect(stagingArtifacts(dir).length).toBeGreaterThan(0);

		const retry = runSetup(dir, [...REQUIRED, ...IDENTITY]);
		expect(retry.code, retry.stderr).toBe(0);
		expect(readFileSync(at(dir, LEGAL_OUTPUTS[0]))).toEqual(expectedConfig);
		expect(readFileSync(at(dir, LEGAL_OUTPUTS[1]))).toEqual(expectedDates);
	});
});

describe.each(LAYOUTS)('template setup path preflight in the $name tree', (layout) => {
	it('rejects a symlink target before creating staging directories', () => {
		const dir = createFixture(layout);
		const readme = at(dir, 'README.md');
		const realReadme = at(dir, 'README.real.md');
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
		const dir = createFixture(layout);
		const readme = at(dir, 'README.md');
		const peer = at(dir, 'README.peer.md');
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
		const dir = createFixture(layout);
		const config = dirname(at(dir, 'src/lib/config/legal.ts'));
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

describe.each(LAYOUTS)('template setup structural process guards in the $name tree', (layout) => {
	it('rejects a template decoy with an indirect real LEGAL_CONFIG before writes', () => {
		const dir = createFixture(layout);
		const legal = at(dir, 'src/lib/config/legal.ts');
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
		const dir = createFixture(layout);
		const readme = at(dir, 'README.md');
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
		const dir = createFixture(layout);
		const readme = at(dir, 'README.md');
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
		const dir = createFixture(layout);
		const readme = at(dir, 'README.md');
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

describe.each(LAYOUTS)(
	'template setup checks write access before the first write in the $name tree',
	(layout) => {
		it.skipIf(!writeDenialEnforced)(
			'writes nothing when a planned output file is read-only',
			() => {
				const dir = createFixture(layout);
				const readme = at(dir, 'README.md');
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
			}
		);

		it.skipIf(!parentWriteDenialEnforced)(
			'writes nothing when a canonical parent directory is read-only',
			() => {
				const dir = createFixture(layout);
				const rootFiles = ['package.json', 'bun.lock', 'README.md', 'wrangler.toml'] as const;
				const before = snapshot(dir);
				chmodSync(dir, 0o555);

				try {
					expect(() => mkdtempSync(join(dir, '.write-probe-'))).toThrow();
					for (const rel of rootFiles) accessSync(at(dir, rel), constants.W_OK);
					accessSync(dirname(at(dir, 'src/lib/config/legal.ts')), constants.W_OK);
					accessSync(dirname(at(dir, LEGAL_DATES)), constants.W_OK);

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
	}
);

describe.each(LAYOUTS)('template setup help in the $name tree', (layout) => {
	it('prints the supported flags and writes nothing', () => {
		const dir = createFixture(layout);
		const before = snapshot(dir);

		const run = runSetup(dir, ['--help']);
		expect(run.code).toBe(0);
		expect(run.stdout).toContain('--slug');
		expect(run.stdout).toContain('Unknown flags are rejected before any file is written.');
		expect(snapshot(dir)).toEqual(before);
	});
});

describe.each(LAYOUTS)('template setup --without-tests in the $name tree', (layout) => {
	const TEMPLATE_URL = 'https://github.com/stickerdaniel/saas-starter.git';
	const TEMPLATE_SHA = 'a'.repeat(40);
	const SCAFFOLD = '.saas-starter-scaffold.json';
	const GIT_ENV: NodeJS.ProcessEnv = {
		...CHILD_ENV,
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
		GIT_AUTHOR_NAME: 'Fixture',
		GIT_AUTHOR_EMAIL: 'fixture@example.com',
		GIT_COMMITTER_NAME: 'Fixture',
		GIT_COMMITTER_EMAIL: 'fixture@example.com'
	};
	const SUITE = ['e2e/public.spec.ts', 'e2e/utils/auth.ts', 'src/lib/effect/clock.test.ts'];
	const KEPT = ['src/lib/effect/clock.ts', 'src/lib/confect/demo.spec.ts'];

	function git(dir: string, args: string[]): string {
		const result = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', env: GIT_ENV });
		if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
		return result.stdout.trim();
	}

	function write(dir: string, files: Record<string, string>): void {
		for (const [rel, content] of Object.entries(files)) {
			mkdirSync(dirname(at(dir, rel)), { recursive: true });
			writeFileSync(at(dir, rel), content);
		}
	}

	function tree(dir: string): Record<string, string> {
		const files: Record<string, string> = {};
		const visit = (rel: string): void => {
			for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
				const path = rel ? `${rel}/${entry.name}` : entry.name;
				if (path === '.git') continue;
				if (entry.isDirectory()) visit(path);
				else if (entry.isFile()) files[path] = readFileSync(join(dir, path), 'utf-8');
				else files[path] = 'link';
			}
		};
		visit('');
		return files;
	}

	function scaffold(phase = 'setup'): string {
		return JSON.stringify({
			version: 1,
			state: 'incomplete',
			phase,
			source: 'stickerdaniel/saas-starter',
			ref: 'main',
			sha: TEMPLATE_SHA
		});
	}

	/** A directory as the creator leaves it before setup: the archive, its marker, and the list. */
	function staged(phase = 'setup'): { dir: string; list: string } {
		const dir = createFixture(layout);
		writeFileSync(
			at(dir, 'package.json'),
			layout.manifest(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
		);
		const helper = '.agents/skills/upstream-sync/scripts/scaffold-marker.ts';
		mkdirSync(dirname(at(dir, helper)), { recursive: true });
		cpSync(join(ROOT, helper), at(dir, helper));
		write(dir, Object.fromEntries([...SUITE, ...KEPT].map((rel) => [rel, `// ${rel}\n`])));
		const list = `${dir}-archive-files.json`;
		fixtures.push(list);
		writeFileSync(
			list,
			JSON.stringify([...FIXTURE_FILES, helper, ...SUITE, ...KEPT].map(layout.place))
		);
		write(dir, { [SCAFFOLD]: scaffold(phase) });
		return { dir, list };
	}

	function args(list?: string): string[] {
		return [
			...REQUIRED,
			...IDENTITY,
			'--without-tests',
			...(list === undefined ? [] : ['--archive-files', list])
		];
	}

	function marker(dir: string): unknown {
		const path = at(dir, '.upstream-sync.json');
		return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : undefined;
	}

	function setup(dir: string, argv: string[], preload?: string) {
		return runSetup(dir, argv, preload, GIT_ENV);
	}

	function installLines(stdout: string): string[] {
		return stdout.split('\n').filter((line) => line.includes('bun install'));
	}

	it('deletes the listed suite of a staged project and records it in the marker', () => {
		const { dir, list } = staged();

		const run = setup(dir, args(list));

		expect(run.code, run.stderr).toBe(0);
		expect([...SUITE, ...KEPT].filter((rel) => existsSync(at(dir, rel)))).toEqual(KEPT);
		expect(marker(dir)).toEqual({ forkPoint: TEMPLATE_SHA, omitted: ['tests'] });
		expect(run.stdout).toContain(
			`Deleted 3 test files. Template commit ${TEMPLATE_SHA} still holds them.`
		);
		const pkg = JSON.parse(readFileSync(at(dir, 'package.json'), 'utf-8'));
		expect(pkg.scripts).not.toHaveProperty('test:e2e');
		expect(pkg.devDependencies).not.toHaveProperty('miniflare');
	});

	it('reduces a staged project and keeps its workspaces and the workspace graph check', () => {
		const { dir, list } = staged();
		const spec = 'src/lib/components/ui/button/button.spec.ts';
		const graphCheck = 'scripts/check-workspace-graph.ts';
		write(dir, { [spec]: '// spec\n', [graphCheck]: '// graph\n' });
		const listed: string[] = JSON.parse(readFileSync(list, 'utf-8'));
		writeFileSync(list, JSON.stringify([...listed, layout.place(spec), layout.place(graphCheck)]));
		const { workspaces } = JSON.parse(readFileSync(at(dir, 'package.json'), 'utf-8'));

		const run = setup(dir, args(list));

		expect(run.code, run.stderr).toBe(0);
		expect([...SUITE, spec].filter((rel) => existsSync(at(dir, rel)))).toEqual([]);
		expect([...KEPT, graphCheck].filter((rel) => !existsSync(at(dir, rel)))).toEqual([]);
		expect(existsSync(at(dir, 'packages/create-saas-starter'))).toBe(false);
		const pkg = JSON.parse(readFileSync(at(dir, 'package.json'), 'utf-8'));
		expect(pkg).toMatchObject({ templateSetupVersion: layout.version, workspaces });
		expect(pkg.scripts).not.toHaveProperty('test:e2e');
		expect(readFileSync(at(dir, 'wrangler.toml'), 'utf-8')).toMatch(/^name = "northwind-labs"/m);
	});

	it('refuses in a Git repository even with the template as its remote', () => {
		const { dir, list } = staged();
		git(dir, ['init', '-q', '-b', 'main']);
		git(dir, ['add', '-A']);
		git(dir, ['commit', '-q', '--no-verify', '-m', 'template']);
		git(dir, ['remote', 'add', 'origin', TEMPLATE_URL]);
		const before = tree(dir);

		const run = setup(dir, args(list));

		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			'--without-tests removes the test suite only while create-saas-starter stages a new project. This directory is a Git repository, so setup deleted nothing.'
		);
		expect(tree(dir)).toEqual(before);
	});

	it.each<[string, (dir: string) => NodeJS.ProcessEnv]>([
		[
			'in a Git repository while git is not on PATH',
			(dir) => {
				git(dir, ['init', '-q', '-b', 'main']);
				git(dir, ['add', '-A']);
				git(dir, ['commit', '-q', '--no-verify', '-m', 'template']);
				const env = { ...GIT_ENV, PATH: dirname(BUN) };
				expect(() => testExecutable('git', dir, env)).toThrow();
				return env;
			}
		],
		[
			'with a .git file that names a missing directory',
			(dir) => {
				writeFileSync(at(dir, '.git'), `gitdir: ${at(dir, 'missing')}\n`);
				return GIT_ENV;
			}
		]
	])('refuses %s and deletes nothing', (_, prepare) => {
		const { dir, list } = staged();
		const env = prepare(dir);
		const before = tree(dir);

		const run = runSetup(dir, args(list), undefined, env);

		expect(run.code).toBe(1);
		expect(run.stderr).toContain('This directory is a Git repository, so setup deleted nothing.');
		expect(tree(dir)).toEqual(before);
		expect(existsSync(at(dir, '.git'))).toBe(true);
	});

	it.each<[string, string]>([
		['e2e/archive.test.json that names itself', 'e2e/archive.test.json'],
		['archive-list.json in the root, given as a relative path', 'archive-list.json']
	])('refuses a list at %s and deletes nothing', (_, rel) => {
		const { dir, list } = staged();
		write(dir, { [rel]: JSON.stringify([...JSON.parse(readFileSync(list, 'utf-8')), rel]) });
		const given = rel.includes('/') ? at(dir, rel) : rel;
		const before = tree(dir);

		const run = setup(dir, args(given));

		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			`--archive-files ${given} lies inside the project. The list must be outside the project directory. Setup deleted nothing.`
		);
		expect(tree(dir)).toEqual(before);
	});

	it('refuses a link in the project that leads to a list outside it', () => {
		const { dir, list } = staged();
		const link = at(dir, 'archive-list.json');
		symlinkSync(list, link, 'file');
		const before = tree(dir);

		const run = setup(dir, args(link));

		expect(run.code).toBe(1);
		expect(run.stderr).toContain(`--archive-files ${link} lies inside the project.`);
		expect(tree(dir)).toEqual(before);
	});

	const caseInsensitive = (() => {
		const probe = mkdtempSync(join(tmpdir(), 'template-setup-case-'));
		fixtures.push(probe);
		writeFileSync(join(probe, 'a'), '');
		return existsSync(join(probe, 'A'));
	})();

	it.runIf(caseInsensitive)('keeps a changed file below e2e renamed to E2E', () => {
		const { dir, list } = staged();
		rmSync(at(dir, 'e2e/public.spec.ts'));
		const renamed = join(dirname(at(dir, 'e2e')), 'E2E');
		renameSync(at(dir, 'e2e'), renamed);
		writeFileSync(join(renamed, 'utils/auth.ts'), 'mine\n');

		const run = setup(dir, args(list));

		expect(run.code, run.stderr).toBe(0);
		expect(readFileSync(join(renamed, 'utils/auth.ts'), 'utf-8')).toBe('mine\n');
		expect(existsSync(at(dir, 'src/lib/effect/clock.test.ts'))).toBe(false);
	});

	function refusesReplacedTestFile(replace: (path: string) => void): void {
		const { dir, list } = staged();
		const path = at(dir, 'src/lib/effect/clock.test.ts');
		rmSync(path);
		replace(path);
		const before = tree(dir);

		const run = setup(dir, args(list));

		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			`Could not delete ${layout.place('src/lib/effect/clock.test.ts')}: it is no regular file, so setup deleted nothing.`
		);
		expect(tree(dir)).toEqual(before);
	}

	it('refuses a listed test file replaced by a link to a file outside the project', () => {
		const outside = mkdtempSync(join(tmpdir(), 'template-setup-outside-'));
		fixtures.push(outside);
		writeFileSync(join(outside, 'clock.test.ts'), 'outside\n');

		refusesReplacedTestFile((path) => symlinkSync(join(outside, 'clock.test.ts'), path, 'file'));

		expect(readFileSync(join(outside, 'clock.test.ts'), 'utf-8')).toBe('outside\n');
	});

	it.skipIf(process.platform === 'win32')('refuses a listed test file replaced by a FIFO', () => {
		refusesReplacedTestFile((path) => {
			const made = spawnSync('mkfifo', [path], { encoding: 'utf-8' });
			if (made.status !== 0) throw new Error(`mkfifo: ${made.stderr}`);
		});
	});

	it('refuses a reduced package.json that has miniflare back and deletes nothing', () => {
		const { dir, list } = staged();
		const reduced = JSON.parse(
			reduceManifest(readFileSync(at(dir, 'package.json'), 'utf-8'), ['tests'])
		);
		reduced.devDependencies.miniflare = '^4.0.0';
		write(dir, { 'package.json': JSON.stringify(reduced, null, '\t') + '\n' });
		const before = tree(dir);

		const run = setup(dir, args(list));

		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			'package.json is neither full nor reduced for the tests set: it names the scripts [] and the devDependencies ["miniflare"], so setup deleted nothing.'
		);
		expect(tree(dir)).toEqual(before);
	});

	it.each<[string, (list: string) => string | undefined, string]>([
		[
			'without --archive-files',
			() => undefined,
			'--without-tests needs --archive-files, the list of the files create-saas-starter extracted. Setup deleted nothing.'
		],
		[
			'with a list that is no array of strings',
			(list) => {
				writeFileSync(list, JSON.stringify({ files: ['e2e/public.spec.ts'] }));
				return list;
			},
			'holds no JSON array of strings'
		],
		[
			'with a listed path that has a .. segment',
			(list) => {
				writeFileSync(list, JSON.stringify(['e2e/../e2e/public.spec.ts']));
				return list;
			},
			'it has an empty, . or .. segment'
		]
	])('refuses a staged project %s and deletes nothing', (_, listFile, message) => {
		const { dir, list } = staged();
		const before = tree(dir);

		const run = setup(dir, args(listFile(list)));

		expect(run.code).toBe(1);
		expect(run.stderr).toContain(message);
		expect(tree(dir)).toEqual(before);
	});

	it('refuses a scaffold marker in phase install and deletes nothing', () => {
		const { dir, list } = staged('install');
		const before = tree(dir);

		const run = setup(dir, args(list));

		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			'No scaffold marker in phase setup is here, so setup deleted nothing.'
		);
		expect(tree(dir)).toEqual(before);
	});

	it('refuses test files that the list does not name, names them and deletes nothing', () => {
		const { dir, list } = staged();
		write(dir, {
			'node_modules/vendor/ours.test.js': 'installed\n',
			'e2e/mine.spec.ts': 'mine\n'
		});
		const before = tree(dir);

		const run = setup(dir, args(list));

		expect(run.code).toBe(1);
		expect(run.stderr).toContain(
			`--without-tests deletes only files of the template archive. These test files are not in the list from --archive-files, so setup deleted nothing:\n  ${layout.place('e2e/mine.spec.ts')}\n  node_modules/vendor/ours.test.js\n`
		);
		expect(tree(dir)).toEqual(before);
	});

	it('names at most 20 unlisted test files and counts the rest', () => {
		const { dir, list } = staged();
		const added = Array.from(
			{ length: 23 },
			(_, i) => `src/added-${String(i).padStart(2, '0')}.test.ts`
		);
		write(dir, Object.fromEntries(added.map((rel) => [rel, ''])));

		const run = setup(dir, args(list));

		expect(run.code).toBe(1);
		const prefix = `  ${layout.place('src/added-')}`;
		const named = run.stderr.split('\n').filter((line) => line.startsWith(prefix));
		expect(named).toEqual(added.slice(0, 20).map((rel) => `  ${layout.place(rel)}`));
		expect(run.stderr).toContain('\n  and 3 more\n');
	});

	it('accepts a project nested in another work tree only with the list', () => {
		const parent = mkdtempSync(join(tmpdir(), 'template-setup-parent-'));
		fixtures.push(parent);
		git(parent, ['init', '-q', '-b', 'main']);
		const { dir: source, list } = staged();
		const dir = join(parent, 'apps/product');
		mkdirSync(dirname(dir), { recursive: true });
		renameSync(source, dir);
		fixtureLayouts.set(dir, layout);
		const before = tree(dir);

		const refused = setup(dir, args());
		expect(refused.code).toBe(1);
		expect(refused.stderr).toContain('--without-tests needs --archive-files');
		expect(tree(dir)).toEqual(before);

		const run = setup(dir, args(list));
		expect(run.code, run.stderr).toBe(0);
		expect(SUITE.filter((rel) => existsSync(at(dir, rel)))).toEqual([]);
	});

	it('follows no link when e2e links out of the project', () => {
		const { dir, list } = staged();
		const outside = mkdtempSync(join(tmpdir(), 'template-setup-outside-'));
		fixtures.push(outside);
		writeFileSync(join(outside, 'public.spec.ts'), 'outside\n');
		rmSync(at(dir, 'e2e'), { recursive: true });
		symlinkSync(outside, at(dir, 'e2e'), process.platform === 'win32' ? 'junction' : 'dir');

		const run = setup(dir, args(list));

		expect(run.code, run.stderr).toBe(0);
		expect(run.stdout).toContain('Deleted 1 test files.');
		expect(readFileSync(join(outside, 'public.spec.ts'), 'utf-8')).toBe('outside\n');
		expect(lstatSync(at(dir, 'e2e')).isDirectory()).toBe(false);
	});

	it('rejects --archive-files without --without-tests before any write', () => {
		const { dir, list } = staged();
		const before = tree(dir);

		const run = setup(dir, [...REQUIRED, ...IDENTITY, '--archive-files', list]);

		expect(run.code).toBe(1);
		expect(run.stderr).toContain('--archive-files works only with --without-tests.');
		expect(run.stdout).not.toContain('Applying:');
		expect(tree(dir)).toEqual(before);
	});

	it('names test commands and install steps in the summary only for its profile', () => {
		const full = setup(staged().dir, [...REQUIRED, ...IDENTITY]);
		const project = staged();
		const reduced = setup(project.dir, args(project.list));

		expect(full.code, full.stderr).toBe(0);
		expect(reduced.code, reduced.stderr).toBe(0);
		expect(full.stdout).toContain('Refresh email snapshots');
		expect(installLines(full.stdout)).toEqual([]);
		expect(reduced.stdout).not.toMatch(/test:unit|test:e2e|snapshots/);
		expect(installLines(reduced.stdout)).toEqual([
			'  1. Update bun.lock without the test dependencies: bun install',
			'  2. Check the lockfile: bun install --frozen-lockfile'
		]);

		const later = setup(project.dir, [...REQUIRED, ...IDENTITY]);

		expect(later.code, later.stderr).toBe(0);
		expect(later.stdout).not.toMatch(/test:unit|test:e2e|snapshots/);
		expect(installLines(later.stdout)).toEqual([]);
	});

	it('adds omitted to an existing marker and keeps every other field', () => {
		const { dir, list } = staged();
		const existing = {
			upstreamUrl: TEMPLATE_URL,
			forkPoint: TEMPLATE_SHA,
			lastSynced: TEMPLATE_SHA,
			syncedAt: '2026-11-01T00:00:00.000Z',
			excluded: [{ sha: 'abcdef12', reason: 'own pricing' }]
		};
		write(dir, { '.upstream-sync.json': JSON.stringify(existing, null, '\t') + '\n' });

		const run = setup(dir, args(list));

		expect(run.code, run.stderr).toBe(0);
		expect(marker(dir)).toEqual({ ...existing, omitted: ['tests'] });
	});

	it('changes no file when a finished run is repeated', () => {
		const { dir, list } = staged();
		const first = setup(dir, args(list));
		expect(first.code, first.stderr).toBe(0);
		const after = tree(dir);

		const repeat = setup(dir, args(list));

		expect(repeat.code, repeat.stderr).toBe(0);
		expect(tree(dir)).toEqual(after);
	});

	describe('a repeat after a stop ends where an uninterrupted run ends', () => {
		type StopPoint = 'first-deletion' | 'before-legal' | 'before-site' | 'before-marker';

		function stopPreload(dir: string, point: StopPoint): string {
			const preload = join(dir, '..', `${dir.split(/[\\/]/).at(-1)}-${point}.mjs`);
			fixtures.push(preload);
			writeFileSync(
				preload,
				`import { mock } from 'bun:test';
import defaultFs, * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const point = ${JSON.stringify(point)};
const normalize = (value) => String(value).replaceAll('\\\\', '/');
const stop = () => process.kill(process.pid, 'SIGKILL');
const { rmSync, mkdtempSync, writeFileSync } = fs;
let removals = 0;
const replacements = {
	rmSync(path, options) {
		if (point === 'first-deletion' && ++removals === 2) stop();
		return rmSync(path, options);
	},
	mkdtempSync(prefix, options) {
		const stage = normalize(prefix);
		if (point === 'before-legal' || (point === 'before-site' && stage.endsWith('-site.ts-'))) stop();
		return mkdtempSync(prefix, options);
	},
	writeFileSync(path, data, options) {
		if (point === 'before-marker' && normalize(path).endsWith('/.upstream-sync.json')) stop();
		return writeFileSync(path, data, options);
	}
};
Object.assign(defaultFs, replacements);
syncBuiltinESMExports();
mock.module('fs', () => ({ ...fs, ...replacements }));
mock.module('node:fs', () => ({ ...fs, ...replacements }));
`
			);
			return preload;
		}

		const stoppedState: Record<StopPoint, (dir: string) => unknown> = {
			'first-deletion': (dir) => SUITE.filter((rel) => existsSync(at(dir, rel))).length,
			'before-legal': (dir) => [
				SUITE.filter((rel) => existsSync(at(dir, rel))).length,
				readFileSync(at(dir, 'src/lib/config/legal.ts'), 'utf-8').includes('Northwind')
			],
			'before-site': (dir) => [
				readFileSync(at(dir, 'README.md'), 'utf-8').startsWith('# Northwind Labs'),
				readFileSync(at(dir, 'src/lib/config/site.ts'), 'utf-8').includes('northwind/')
			],
			'before-marker': (dir) => [
				readFileSync(at(dir, 'src/app.html'), 'utf-8').includes('Northwind Labs'),
				existsSync(at(dir, '.upstream-sync.json'))
			]
		};
		const expectedStop: Record<StopPoint, unknown> = {
			'first-deletion': 2,
			'before-legal': [0, false],
			'before-site': [true, false],
			'before-marker': [true, false]
		};

		it.each<StopPoint>(['first-deletion', 'before-legal', 'before-site', 'before-marker'])(
			'stopped at %s',
			(point) => {
				const reference = staged();
				const uninterrupted = setup(reference.dir, args(reference.list));
				expect(uninterrupted.code, uninterrupted.stderr).toBe(0);

				const { dir, list } = staged();
				const stopped = setup(dir, args(list), stopPreload(dir, point));
				expect(stopped.code).not.toBe(0);
				expect(stoppedState[point](dir)).toEqual(expectedStop[point]);

				const repeat = setup(dir, args(list));
				expect(repeat.code, repeat.stderr).toBe(0);
				expect(tree(dir)).toEqual(tree(reference.dir));
				expect(marker(dir)).toEqual(marker(reference.dir));
				expect(installLines(repeat.stdout)).toEqual(installLines(uninterrupted.stdout));
			},
			60_000
		);
	});
});
