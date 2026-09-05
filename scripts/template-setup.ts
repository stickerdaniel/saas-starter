/**
 * Template setup script — replaces project-specific placeholders after
 * generating a new repo from the GitHub template.
 *
 * Safe to re-run: prompts with current values as defaults.
 *
 * Usage:
 *   bun run setup
 *   bun run setup --slug my-app --repo owner/my-app --brand "My App"
 *
 * Non-interactive mode (piped stdin, CI, agents) requires --slug, --repo, --brand
 * while those still hold their template values. Identity fields (brand, company,
 * operator, address, email) preserve the current legal.ts values when no flag is
 * given, so a re-run without flags keeps the configured identity.
 *
 * Läuft ohne installierte Dependencies: es werden nur Node-Builtins und reine
 * lokale Module importiert.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface, type Interface } from 'readline';
import { pathToFileURL } from 'url';
import { parseArgs } from 'util';
import { isIsoCalendarDate } from '../src/lib/content/legal-metadata';

const ROOT = join(import.meta.dirname, '..');

/** Werte, die noch auf dem Template-Stand stehen und daher gesetzt werden müssen. */
const TEMPLATE_SLUG = 'saas-starter';
const TEMPLATE_REPOSITORY = 'stickerdaniel/saas-starter';
const TEMPLATE_BRAND = 'SaaS Starter';

function normalizeFlag(v: unknown): string | undefined {
	if (typeof v !== 'string') return undefined;
	const t = v.trim();
	return t === '' ? undefined : t;
}

interface SetupFlags {
	slug?: string;
	repo?: string;
	brand?: string;
	company?: string;
	operator?: string;
	address?: string;
	email?: string;
}

/**
 * Parsed on demand rather than at module load, so importing the pure helpers
 * below (see template-setup.test.ts) neither reads argv nor exits the process.
 */
function readFlags(): SetupFlags {
	let values: Record<string, unknown>;
	try {
		// strict: unbekannte Flags sind Tippfehler und dürfen nicht stillschweigend
		// verworfen werden, bevor irgendetwas geschrieben wird.
		({ values } = parseArgs({
			args: process.argv.slice(2),
			options: {
				slug: { type: 'string' },
				repo: { type: 'string' },
				brand: { type: 'string' },
				company: { type: 'string' },
				operator: { type: 'string' },
				address: { type: 'string' },
				email: { type: 'string' },
				help: { type: 'boolean', short: 'h', default: false }
			},
			strict: true,
			allowPositionals: false
		}));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}\nRun bun run setup --help to see the supported flags.`);
		process.exit(1);
	}

	if (values.help) {
		console.log(`Template Setup

Usage:
  bun run setup                                          (interactive)
  bun run setup --slug <s> --repo <owner/name> --brand <s> [--company <s>] [--operator <s>] [--address <s>] [--email <user@domain.tld>]

Flags:
  --slug      Project slug (lowercase, hyphens; matches ^[a-z0-9-]+$)
  --repo      GitHub repo in owner/name format
  --brand     Brand display name
  --company   Company name (legal entity)
  --operator  Operator name (person or org running the service)
  --address   Address used in Impressum and email footer
  --email     Contact email in user@domain.tld form
  -h, --help  Show this help

In non-interactive mode (piped stdin, CI), --slug, --repo, --brand are required
while they still hold their template values.
Identity fields without flags preserve current legal.ts values.
In interactive mode, missing flags are prompted with current values as defaults.
Unknown flags are rejected before any file is written.`);
		process.exit(0);
	}

	return {
		slug: normalizeFlag(values.slug),
		repo: normalizeFlag(values.repo),
		brand: normalizeFlag(values.brand),
		company: normalizeFlag(values.company),
		operator: normalizeFlag(values.operator),
		address: normalizeFlag(values.address),
		email: normalizeFlag(values.email)
	};
}

const interactive = !!process.stdin.isTTY;
let rl: Interface | undefined;
function ensureReadline(): Interface {
	if (!rl) {
		rl = createInterface({ input: process.stdin, output: process.stdout });
		// Ctrl-C beendet die Eingabe wie ein EOF, statt den Prozess mit offener
		// Schnittstelle hängen zu lassen.
		rl.on('SIGINT', () => rl?.close());
	}
	return rl;
}

/** Bricht kontrolliert ab: immer vor dem ersten Write und mit geschlossener Eingabe. */
function fail(message: string): never {
	console.error(`Error: ${message}`);
	rl?.close();
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), 'utf-8');
}

function write(rel: string, content: string): void {
	writeFileSync(join(ROOT, rel), content, 'utf-8');
}

/**
 * Fragt eine Eingabe ab. Liefert undefined, wenn stdin schließt (EOF, Ctrl-D,
 * Ctrl-C), damit der Aufrufer sauber abbrechen kann.
 */
function prompt(question: string, fallback: string): Promise<string | undefined> {
	const iface = ensureReadline();
	return new Promise((resolve) => {
		let answered = false;
		const onClose = () => {
			if (!answered) resolve(undefined);
		};
		iface.once('close', onClose);
		iface.question(`${question} [${fallback}]: `, (answer) => {
			answered = true;
			iface.off('close', onClose);
			resolve(answer.trim() || fallback);
		});
	});
}

/** Gibt eine Fehlermeldung zurück, wenn der Wert unbrauchbar ist, sonst undefined. */
export type Validator = (value: string) => string | undefined;

/**
 * Fragt so lange erneut, bis eine gültige Antwort vorliegt. Liefert undefined,
 * wenn die Eingabe endet (EOF, Ctrl-D, Ctrl-C), damit der Aufrufer abbrechen kann.
 */
export async function askUntilValid(
	ask: (question: string, fallback: string) => Promise<string | undefined>,
	question: string,
	fallback: string,
	validate: Validator | undefined,
	report: (problem: string) => void
): Promise<string | undefined> {
	for (;;) {
		const answer = await ask(question, fallback);
		if (answer === undefined) return undefined;
		const problem = validate?.(answer);
		if (!problem) return answer;
		report(problem);
	}
}

async function resolveValue(
	flag: string | undefined,
	question: string,
	fallback: string,
	validate?: Validator
): Promise<string> {
	if (flag !== undefined) {
		const problem = validate?.(flag);
		if (problem) fail(problem);
		return flag;
	}
	if (!interactive) {
		const problem = validate?.(fallback);
		if (problem) fail(problem);
		return fallback;
	}
	const answer = await askUntilValid(prompt, question, fallback, validate, (problem) =>
		console.error(`  ${problem}`)
	);
	if (answer === undefined) fail('setup aborted, no input available on stdin');
	return answer;
}

function titleCase(slug: string): string {
	return slug
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

// ---------------------------------------------------------------------------
// Sichere Serialisierung
// ---------------------------------------------------------------------------

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Erzeugt ein TypeScript-Stringliteral. JSON.stringify maskiert Backslashes,
 * Steuerzeichen und Zeilenumbrüche korrekt; anschließend wird auf die Quote-Wahl
 * umgestellt, die Prettier für diese Datei träfe (einfache Quotes, außer der Wert
 * enthält davon mehr als doppelte).
 */
export function tsStringLiteral(value: string): string {
	const singleQuotes = value.split("'").length - 1;
	const doubleQuotes = value.split('"').length - 1;
	const quote = singleQuotes > doubleQuotes ? '"' : "'";
	const escaped = JSON.stringify(value)
		.slice(1, -1)
		.split('\\"')
		.join('"')
		.split(quote)
		.join(`\\${quote}`);
	return `${quote}${escaped}${quote}`;
}

function tsKey(key: string): string {
	return IDENTIFIER.test(key) ? key : tsStringLiteral(key);
}

/**
 * Serialisiert die Konfiguration als TypeScript-Objektliteral. Zusätzliche
 * Schlüssel eines Forks bleiben erhalten, weil über die tatsächlichen Einträge
 * iteriert wird.
 */
export function serializeConfigValue(value: unknown, indent: string): string {
	if (typeof value === 'string') return tsStringLiteral(value);
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0) return '{}';
		const inner = `${indent}\t`;
		const body = entries
			.map(([key, item]) => `${inner}${tsKey(key)}: ${serializeConfigValue(item, inner)}`)
			.join(',\n');
		return `{\n${body}\n${indent}}`;
	}
	throw new Error(`Unsupported LEGAL_CONFIG value of type ${typeof value}`);
}

function legalConfigBlockPattern(): RegExp {
	return /^export const LEGAL_CONFIG = \{[\s\S]*?^\} as const;$/gm;
}

/**
 * Ersetzt den eindeutigen LEGAL_CONFIG-Exportblock. Die Hilfsfunktionen und alle
 * übrigen Dateiinhalte bleiben unberührt.
 */
export function replaceLegalConfigSource(source: string, config: Record<string, unknown>): string {
	const matches = source.match(legalConfigBlockPattern());
	if (matches?.length !== 1) {
		throw new Error(
			`Expected exactly one LEGAL_CONFIG block in src/lib/config/legal.ts, found ${matches?.length ?? 0}`
		);
	}
	const block = `export const LEGAL_CONFIG = ${serializeConfigValue(config, '')} as const;`;
	// Replacement-Callback: $&, $1 und $` in Branding-Werten dürfen nicht als
	// Ersetzungsmuster interpretiert werden.
	return source.replace(legalConfigBlockPattern(), () => block);
}

// ---------------------------------------------------------------------------
// Detect current values (for re-run defaults)
// ---------------------------------------------------------------------------

function currentSlug(): string {
	const pkg = JSON.parse(read('package.json'));
	return pkg.name ?? TEMPLATE_SLUG;
}

function currentRepo(): string {
	const siteConfig = read('src/lib/config/site.ts');
	const match = siteConfig.match(/githubSlug:\s*['"]([^'"]+)['"]/);
	return match?.[1] ?? 'user/my-saas';
}

/**
 * Liest die rechtlichen Defaults aus dem reinen Modul statt per Regex. Ist die
 * Datei beschädigt, scheitert der Import hier — vor jedem Write.
 */
async function readLegalConfig(): Promise<Record<string, unknown>> {
	const modulePath = join(ROOT, 'src/lib/config/legal.ts');
	const imported = (await import(pathToFileURL(modulePath).href)) as {
		LEGAL_CONFIG?: unknown;
	};
	const config = imported.LEGAL_CONFIG;
	if (config === null || typeof config !== 'object' || Array.isArray(config)) {
		throw new Error('Could not read LEGAL_CONFIG from src/lib/config/legal.ts');
	}
	return structuredClone(config) as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string): string {
	const value = source[key];
	return typeof value === 'string' ? value : '';
}

export function isValidGithubRepository(value: string): boolean {
	const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(value);
	if (!match) return false;
	const owner = match[1]!;
	const repository = match[2]!;
	return (
		owner.length <= 39 &&
		!owner.startsWith('-') &&
		!owner.endsWith('-') &&
		!owner.includes('--') &&
		!['.', '..'].includes(repository) &&
		!repository.toLowerCase().endsWith('.git')
	);
}

export function githubSlugProperty(value: string): string {
	if (!isValidGithubRepository(value)) {
		throw new Error(`Invalid GitHub repository: ${value}`);
	}
	return `githubSlug: '${value}'`;
}

export function replaceGithubSlugSource(source: string, value: string): string {
	const pattern = /githubSlug:\s*['"][^'"]+['"]/g;
	const matches = source.match(pattern);
	if (!matches) {
		throw new Error('Could not find githubSlug in src/lib/config/site.ts');
	}
	// Ein zweites Vorkommen, etwa ein Beispiel im Doc-Kommentar, würde sonst still den
	// falschen Treffer ersetzen und die echte Konfiguration unverändert lassen.
	if (matches.length > 1) {
		throw new Error(
			`Expected exactly one githubSlug in src/lib/config/site.ts, found ${matches.length}`
		);
	}
	return source.replace(pattern, () => githubSlugProperty(value));
}

export function replaceLegalContentDatesSource(source: string, value: string): string {
	if (!isIsoCalendarDate(value)) throw new Error(`Invalid legal content date: ${value}`);
	let replacements = 0;
	const updated = source.replace(/(privacy|terms|impressum): '[^']+'/g, (_match, key: string) => {
		replacements += 1;
		return `${key}: '${value}'`;
	});
	if (replacements !== 3) {
		throw new Error('Could not update every date in src/lib/content/legal-metadata.ts');
	}
	return updated;
}

export function updateLegalContentDatesSource(
	source: string,
	value: string,
	legalIdentityChanged: boolean
): string {
	return legalIdentityChanged ? replaceLegalContentDatesSource(source, value) : source;
}

// ---------------------------------------------------------------------------
// README, wrangler, lockfile
// ---------------------------------------------------------------------------

/**
 * Maskiert Zeichen, die den Markennamen in einer Markdown-Überschrift anders rendern
 * würden. `&` gehört dazu, weil `&copy;` sonst als Entity ankommt, `#` wegen der
 * schließenden Zeichenfolge einer ATX-Überschrift.
 */
export function escapeMarkdownInline(value: string): string {
	return value.replace(/[\\`*_[\]<>&#]/g, (char) => `\\${char}`);
}

/**
 * Repariert Überschrift, Demo-Absatz und Quick Start. Der Quick Start erklärt danach
 * die Einrichtung des erzeugten Projekts statt der Template-Erzeugung. Der Aufruf ist
 * idempotent: die bereits erzeugte Form wird erneut erkannt.
 */
export function replaceReadmeSource(
	source: string,
	options: { brand: string; repository: string; oldGithubUrl: string; githubUrl: string }
): string {
	const { brand, repository, oldGithubUrl, githubUrl } = options;
	const repositoryBasename = repository.split('/')[1]!;

	// Zuerst die Repository-Links, damit der danach erzeugte Quick-Start-Block nicht
	// noch einmal umgeschrieben wird.
	let updated = oldGithubUrl === githubUrl ? source : source.split(oldGithubUrl).join(githubUrl);

	const heading = /^# .+$/m;
	if (!heading.test(updated)) {
		throw new Error('Could not find the top-level heading in README.md');
	}
	updated = updated.replace(heading, () => `# ${escapeMarkdownInline(brand)}`);

	// Der Demo-Absatz gehört zum Template und fehlt nach dem ersten Lauf.
	updated = updated.replace(/^> \[Live demo!\][^\n]*\n\n/m, () => '');

	const clonePattern =
		/^(?:gh repo create [^\n]*|git clone https:\/\/github\.com\/[^\n]*)\ncd [^\n]*$/gm;
	const cloneMatches = updated.match(clonePattern);
	if (cloneMatches?.length !== 1) {
		throw new Error(
			`Expected exactly one quick start clone block in README.md, found ${cloneMatches?.length ?? 0}`
		);
	}
	updated = updated.replace(
		clonePattern,
		() => `git clone ${githubUrl}.git\ncd ${repositoryBasename}`
	);

	return updated;
}

export function replaceWranglerNameSource(source: string, slug: string): string {
	const pattern = /^name = "[^"]*"/gm;
	const matches = source.match(pattern);
	if (matches?.length !== 1) {
		throw new Error(
			`Expected exactly one name assignment in wrangler.toml, found ${matches?.length ?? 0}`
		);
	}
	return source.replace(pattern, () => `name = ${JSON.stringify(slug)}`);
}

/**
 * Synchronisiert allein den Root-Namen im Lockfile. Dependency-Einträge und
 * Versionen bleiben bytegleich; der Abhängigkeitsgraph wird nicht neu berechnet.
 */
export function replaceLockRootNameSource(source: string, slug: string): string {
	const pattern = /("workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
	const matches = source.match(pattern);
	if (matches?.length !== 1) {
		throw new Error(
			`Expected exactly one workspace root name in bun.lock, found ${matches?.length ?? 0}`
		);
	}
	return source.replace(pattern, (_match, prefix: string) => `${prefix}${JSON.stringify(slug)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log('\n📦 Template Setup\n');

	const {
		slug: slugFlag,
		repo: repoFlag,
		brand: brandFlag,
		company: companyFlag,
		operator: operatorFlag,
		address: addressFlag,
		email: emailFlag
	} = readFlags();

	const legalConfig = await readLegalConfig().catch((error: unknown) =>
		fail(error instanceof Error ? error.message : String(error))
	);
	const legalEmail = (legalConfig.email ?? {}) as Record<string, unknown>;

	const oldSlug = currentSlug();
	const oldRepo = currentRepo();
	const oldBrand = readString(legalConfig, 'brandName');
	const oldCompany = readString(legalConfig, 'companyName');
	const oldOperator = readString(legalConfig, 'operatorName');
	const oldAddress = readString(legalConfig, 'address');
	const oldUser = readString(legalEmail, 'user');
	const oldDomain = readString(legalEmail, 'domain');
	const oldTld = readString(legalEmail, 'tld');
	const oldEmail = oldUser && oldDomain && oldTld ? `${oldUser}@${oldDomain}.${oldTld}` : '';

	// Der Markenname darf legitim 'SaaS Starter' lauten. Ob er gesetzt wurde, verrät erst
	// Slug oder Repository: solange beide auf dem Template stehen, ist noch nichts gewählt.
	const alreadySetUp = oldSlug !== TEMPLATE_SLUG || oldRepo !== TEMPLATE_REPOSITORY;

	if (!interactive) {
		// Nur noch nicht gebrandete Werte sind Pflicht, damit ein erneuter Lauf ohne
		// Identitätsflags die gesetzte Identität erhält.
		const missing: string[] = [];
		if (!slugFlag && oldSlug === TEMPLATE_SLUG) missing.push('--slug');
		if (!repoFlag && oldRepo === TEMPLATE_REPOSITORY) missing.push('--repo');
		if (!brandFlag && !alreadySetUp) missing.push('--brand');
		if (missing.length > 0) {
			console.error(
				`Error: bun run setup needs --slug, --repo, --brand in non-interactive mode.\nMissing: ${missing.join(', ')}\nExample: bun run setup --slug my-app --repo owner/my-app --brand "My App"`
			);
			process.exit(1);
		}
	}

	const slug = await resolveValue(
		slugFlag,
		'Project slug (lowercase, no spaces)',
		oldSlug,
		(value) =>
			/^[a-z0-9-]+$/.test(value)
				? undefined
				: 'slug must match ^[a-z0-9-]+$ (lowercase letters, numbers, hyphens)'
	);

	const repo = await resolveValue(repoFlag, 'GitHub repo (owner/name)', oldRepo, (value) =>
		isValidGithubRepository(value) ? undefined : 'repo must use a safe GitHub owner/name format'
	);

	const brand = await resolveValue(
		brandFlag,
		'Brand name (display name)',
		// titleCase nur als Vorschlag für das unberührte Template, nie als Ersatz für
		// einen bereits gewählten Namen.
		!alreadySetUp && (oldBrand === '' || oldBrand === TEMPLATE_BRAND) ? titleCase(slug) : oldBrand,
		(value) => (value.trim() === '' ? 'brand must not be empty' : undefined)
	);

	const company = await resolveValue(
		companyFlag,
		'Company name (legal entity)',
		oldCompany || `${brand} Inc.`
	);

	const operator = await resolveValue(
		operatorFlag,
		'Operator name (person or org running the service)',
		oldOperator
	);

	const address = await resolveValue(
		addressFlag,
		'Address (for Impressum and email footer)',
		oldAddress
	);

	const email = await resolveValue(
		emailFlag,
		'Contact email (user@domain.tld)',
		oldEmail,
		(value) =>
			/^([^@]+)@([^.]+)\.(.+)$/.test(value)
				? undefined
				: `email must match user@domain.tld pattern, got: ${value}`
	);
	const [, emailUser, emailDomain, emailTld] = /^([^@]+)@([^.]+)\.(.+)$/.exec(email)!;

	const githubUrl = `https://github.com/${repo}`;
	const oldGithubUrl = `https://github.com/${oldRepo}`;
	const setupDate = new Date().toISOString().slice(0, 10);
	const legalIdentityChanged =
		brand !== oldBrand ||
		company !== oldCompany ||
		operator !== oldOperator ||
		address !== oldAddress ||
		email !== oldEmail;

	// Alle nächsten Dateiinhalte vor dem ersten Write berechnen. Ein fehlender oder
	// mehrdeutiger Anker scheitert damit, bevor irgendetwas auf der Platte steht.
	const nextLegalConfig = { ...legalConfig };
	nextLegalConfig.brandName = brand;
	nextLegalConfig.companyName = company;
	nextLegalConfig.operatorName = operator;
	nextLegalConfig.address = address;
	nextLegalConfig.email = { ...legalEmail, user: emailUser, domain: emailDomain, tld: emailTld };

	const lockPath = join(ROOT, 'bun.lock');
	const hasLock = existsSync(lockPath);

	let nextPackageJson: string;
	let nextWrangler: string;
	let nextReadme: string;
	let nextSiteConfig: string;
	let nextLegalMetadata: string;
	let nextLegalSource: string;
	let nextLock: string | undefined;
	try {
		const pkg = JSON.parse(read('package.json'));
		pkg.name = slug;
		pkg.author = operator;
		nextPackageJson = JSON.stringify(pkg, null, '\t') + '\n';
		nextWrangler = replaceWranglerNameSource(read('wrangler.toml'), slug);
		nextReadme = replaceReadmeSource(read('README.md'), {
			brand,
			repository: repo,
			oldGithubUrl,
			githubUrl
		});
		nextSiteConfig = replaceGithubSlugSource(read('src/lib/config/site.ts'), repo);
		nextLegalMetadata = updateLegalContentDatesSource(
			read('src/lib/content/legal-metadata.ts'),
			setupDate,
			legalIdentityChanged
		);
		nextLegalSource = replaceLegalConfigSource(read('src/lib/config/legal.ts'), nextLegalConfig);
		nextLock = hasLock ? replaceLockRootNameSource(read('bun.lock'), slug) : undefined;
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	}

	console.log(`\nApplying: slug=${slug}, repo=${repo}, brand="${brand}"\n`);

	write('package.json', nextPackageJson);
	console.log('  ✓ package.json');

	if (nextLock !== undefined) {
		write('bun.lock', nextLock);
		console.log('  ✓ bun.lock (root name)');
	}

	write('wrangler.toml', nextWrangler);
	console.log('  ✓ wrangler.toml');

	write('README.md', nextReadme);
	console.log('  ✓ README.md');

	// Site config — single source for runtime repository links
	write('src/lib/config/site.ts', nextSiteConfig);
	console.log('  ✓ site.ts');

	write('src/lib/content/legal-metadata.ts', nextLegalMetadata);
	console.log(
		legalIdentityChanged
			? `  ✓ legal-metadata.ts (Last Updated: ${setupDate})`
			: '  ✓ legal-metadata.ts (unchanged)'
	);

	// Legal config — single source of truth for brand identity
	write('src/lib/config/legal.ts', nextLegalSource);
	console.log('  ✓ legal.ts');

	console.log('\n✅ Done! Next steps:');
	console.log('  1. Replace static/logo.svg with your logo, then run: bun run build:emails');
	console.log('  2. Refresh email snapshots: bun run test:unit -- email-snapshots.test.ts -u');
	console.log(
		'  3. Update editorial brand mentions in src/i18n/*.json (FAQ, hero, marketing prose, pricing tier names)'
	);
	console.log('  4. Review the legal copy in src/lib/content/legal/*.md');
	console.log('  5. Keep each legal route page.md.ts summary aligned with that copy');
	console.log('  6. Review site.ts structured data and src/lib/content/llms.txt access limits');
	console.log('  7. Review src/lib/convex/support/instructions.txt');
	console.log('');
	rl?.close();
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
