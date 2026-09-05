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
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
	// Der öffentliche Einstieg, damit auch das Skript-Dispatch aus dem Manifest geprüft
	// wird. Die Fixture bringt das reale package.json mit und braucht keine Dependencies.
	const result = spawnSync(BUN, ['run', 'setup', ...args], {
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

/** Wie IDENTITY, aber ohne --brand und --company, damit deren Defaults greifen. */
const IDENTITY_WITHOUT_COMPANY = [
	'--operator',
	'Anne Weber',
	'--address',
	'Hauptstrasse 5, 12345 Berlin',
	'--email',
	'kontakt@northwind-labs.de'
];

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

describe('template setup recognizes a genuinely set up project', () => {
	// Ein von Hand geänderter Package-Name oder githubSlug beweist keine Einrichtung:
	// solange der Quick Start die gh-repo-create-Form trägt, bleibt --brand Pflicht.
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

	it('stops demanding flags once the quick start names this repository', () => {
		const dir = createFixture();
		// Der Slug bleibt bewusst auf dem Template-Wert.
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

	// Brand und Operator werden roh in die Absätze von Privacy und Terms eingesetzt.
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
	it.each(['a@b@c.de', 'erste person@example.de', 'a@ex ample.de', 'a@example..de'])(
		'rejects %s before writing',
		(value) => {
			const dir = createFixture();
			const before = snapshot(dir);

			const run = runSetup(dir, [...REQUIRED, ...IDENTITY.slice(0, 6), '--email', value]);
			expect(run.code).toBe(1);
			expect(run.stderr).toMatch(/email must match user@domain\.tld pattern/);
			expect(snapshot(dir)).toEqual(before);
		}
	);

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

/**
 * Gemessen, nicht angenommen: nur wenn ein echter Schreibversuch auf eine 0444-Datei
 * scheitert, prüft der folgende Test überhaupt eine Schreibverweigerung. Als root
 * bleibt der Fall unbeobachtbar und der Test meldet das, statt Erfolg zu behaupten.
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
