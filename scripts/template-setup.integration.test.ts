/**
 * Führt das echte Setup als eigenen Prozess gegen private Fixture-Kopien aus.
 * Nur der vollständige Lauf zeigt, dass gequotete Branding-Werte importierbaren
 * Code ergeben und dass abgelehnte Eingaben vor dem ersten Write scheitern.
 *
 * Die Fixtures kopieren die tatsächlichen Repository-Dateien und benötigen keine
 * installierten Dependencies, weil das Setup nur Builtins und reine lokale
 * Module importiert.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { testExecutable } from './test-executable';

const ROOT = join(import.meta.dirname, '..');
/** Vorab aufgelöstes reales Bun; der Testrunner selbst läuft unter Node. */
const BUN = testExecutable('bun');

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

function runSetup(dir: string, args: string[]) {
	const result = spawnSync(BUN, [join(dir, 'scripts/template-setup.ts'), ...args], {
		cwd: dir,
		encoding: 'utf-8',
		// stdin bleibt ohne TTY: das Setup läuft nicht-interaktiv, wie unter CI und in der CLI.
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 60_000,
		killSignal: 'SIGKILL'
	});
	return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Importiert die erzeugte legal.ts in einem frischen Prozess. */
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

describe('template setup writes importable branding values', () => {
	// Gewöhnliche Namen genügen: ein Apostroph reicht, um den erzeugten Code zu brechen.
	it.each([
		{ label: 'apostrophe', flag: '--brand', key: 'brandName', value: "O'Connor Software" },
		{
			label: 'double quotes',
			flag: '--company',
			key: 'companyName',
			value: 'The "Blue Door" GmbH'
		},
		{ label: 'backslash', flag: '--operator', key: 'operatorName', value: 'Anne\\Marie Weber' },
		{
			label: 'multiline address',
			flag: '--address',
			key: 'address',
			value: 'Hauptstrasse 5\n12345 Berlin\nDeutschland'
		},
		{
			// $&, $1 und $` dürfen nicht als Ersetzungsmuster interpretiert werden.
			label: 'replacement metacharacters',
			flag: '--brand',
			key: 'brandName',
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

	it('keeps a brand that was deliberately set to the template name', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY.slice(2), '--brand', 'SaaS Starter']).code).toBe(
			0
		);
		const afterFirst = snapshot(dir);

		// titleCase('northwind-labs') wäre 'Northwind Labs'; der gewählte Name gewinnt.
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
		expect(readme).toContain('cd northwind-cloud');
		expect(readme).not.toContain('northwind-labs');
	});
});

describe('template setup quick start', () => {
	it('replaces the template instructions with the generated project setup', () => {
		const dir = createFixture();
		expect(runSetup(dir, [...REQUIRED, ...IDENTITY]).code).toBe(0);

		const readme = readFileSync(join(dir, 'README.md'), 'utf-8');
		expect(readme.split('\n')[0]).toBe('# Northwind Labs');
		expect(readme).toContain(
			'```bash\ngit clone https://github.com/northwind/northwind-labs.git\ncd northwind-labs\nbun install\nbun run dev\n```'
		);
		expect(readme).not.toContain('gh repo create');
		expect(readme).not.toContain('my-saas-product');
		expect(readme).not.toContain('Live demo!');
		// Unverwandte Prosa bleibt erhalten.
		expect(readme).toContain('## Why This Exists');
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
		// Nur der Root-Name ändert sich; der Abhängigkeitsgraph bleibt bytegleich.
		expect(lock).toBe(
			readFileSync(join(ROOT, 'bun.lock'), 'utf-8').replace(
				'"name": "saas-starter"',
				'"name": "northwind-labs"'
			)
		);
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
			label: 'an unsafe repository',
			args: ['--slug', 'northwind-labs', '--repo', 'northwind/repo.git', ...IDENTITY],
			expected: /repo must use a safe GitHub owner\/name format/
		},
		{
			label: 'an invalid email',
			args: [...REQUIRED, ...IDENTITY.slice(0, -1), 'kaputt'],
			expected: /email must match user@domain\.tld pattern/
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
			// Gültige Datei mit einem zweiten Treffer: der erste steht im Doc-Kommentar und
			// steuert die Laufzeit nicht. Stilles Ersetzen träfe den falschen Wert.
			label: 'the site config carries a second githubSlug example',
			file: 'src/lib/config/site.ts',
			mutate: (source: string) =>
				source.replace(
					'export interface SiteConfig {',
					"export interface SiteConfig {\n\t/** Example: githubSlug: 'octocat/hello-world' */"
				),
			expected: /Expected exactly one githubSlug in src\/lib\/config\/site\.ts, found 2/
		},
		{
			label: 'the legal config lost its export block',
			file: 'src/lib/config/legal.ts',
			mutate: (source: string) =>
				source.replace(
					/^export const LEGAL_CONFIG[\s\S]*?^\} as const;$/m,
					"export const LEGAL_CONFIG = { brandName: 'X' };"
				),
			expected: /Expected exactly one LEGAL_CONFIG block/
		},
		{
			label: 'the README lost its quick start',
			file: 'README.md',
			mutate: () => '# Custom Title\n\nUnrelated prose.\n',
			expected: /Expected exactly one quick start clone block/
		},
		{
			label: 'wrangler.toml lost its name assignment',
			file: 'wrangler.toml',
			mutate: (source: string) => source.replace(/^name = "[^"]*".*\n/m, ''),
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
