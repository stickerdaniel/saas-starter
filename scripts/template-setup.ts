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

import { accessSync, constants, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface, type Interface } from 'readline';
import { domainToASCII, pathToFileURL } from 'url';
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
  --slug      Worker slug (1-63 lowercase letters, numbers, or inner hyphens)
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

/**
 * Bewusst enges Subset für die vorhandenen unkodierten mailto-Consumer. Plus,
 * Apostroph und Unicode-Buchstaben bleiben erlaubt; URI-Strukturzeichen und
 * kodierungspflichtige Localparts werden abgelehnt. Kein vollständiger RFC- oder
 * Zustellbarkeitsvalidator.
 */
const EMAIL_LOCAL_PART = /^[\p{L}\p{N}\p{M}._+'-]+$/u;

/** Zerlegt und prüft die Adresse, ohne gültige Originalteile zu normalisieren. */
export function parseContactEmail(
	value: string
): { user: string; domain: string; tld: string } | undefined {
	const at = value.indexOf('@');
	if (at <= 0 || at !== value.lastIndexOf('@')) return undefined;

	const user = value.slice(0, at);
	const userBytes = new TextEncoder().encode(user).byteLength;
	const domainName = value.slice(at + 1);
	if (
		userBytes > 64 ||
		!EMAIL_LOCAL_PART.test(user) ||
		user.startsWith('.') ||
		user.endsWith('.') ||
		user.includes('..')
	) {
		return undefined;
	}

	const labels = domainName.split('.');
	if (labels.length < 2 || labels.some((label) => label === '')) return undefined;
	const asciiLabels: string[] = [];
	for (const label of labels) {
		const ascii = domainToASCII(label);
		if (
			ascii === '' ||
			ascii.length > 63 ||
			!/^[A-Za-z0-9-]+$/.test(ascii) ||
			ascii.startsWith('-') ||
			ascii.endsWith('-')
		) {
			return undefined;
		}
		asciiLabels.push(ascii);
	}
	const asciiDomain = asciiLabels.join('.');
	if (asciiDomain.length > 253 || userBytes + 1 + asciiDomain.length > 254) return undefined;

	return { user, domain: labels[0]!, tld: labels.slice(1).join('.') };
}

/**
 * Brand und Operator landen als Rohtext in den Absätzen von Privacy und Terms.
 * Ein Zeilenumbruch zerlegt dort den Absatz und kann eine zusätzliche Überschrift
 * erzeugen. Die Adresse bleibt bewusst mehrzeilig.
 *
 * Reject only delimiter combinations that create active inline Markdown in that
 * paragraph context. Ordinary punctuation and Unicode symbols remain literal.
 */
const MARKDOWN_INLINE_DELIMITER = /[\\`*_~]/u;
const MARKDOWN_LINK = /!?\[[^\]\r\n]*\](?:\([^\r\n)]*\)|\[[^\]\r\n]*\])/u;
const MARKDOWN_ANGLE_STRUCTURE = /<[^>\r\n]+>/u;

function legalMarkdownTextValidator(label: string): Validator {
	return (value) => {
		if (/[\r\n]/.test(value)) return `${label} must be a single line`;
		return MARKDOWN_INLINE_DELIMITER.test(value) ||
			MARKDOWN_LINK.test(value) ||
			MARKDOWN_ANGLE_STRUCTURE.test(value)
			? `${label} must not contain active Markdown inline syntax such as emphasis, links, code, strikethrough, HTML or autolinks, or escapes`
			: undefined;
	};
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
 * Serialisiert die Einstellungen als TypeScript-Objektliteral. Zusätzliche
 * Schlüssel eines Forks bleiben erhalten, weil über die tatsächlichen Einträge
 * iteriert wird.
 */
export function serializeConfigValue(value: unknown, indent: string): string {
	if (typeof value === 'string') return tsStringLiteral(value);
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Object.prototype || Object.hasOwn(value, '__proto__')) {
			throw new Error('Unsupported LEGAL_CONFIG object type or __proto__ data property');
		}
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
	return findGithubSlugProperty(read('src/lib/config/site.ts')).value;
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
	// Vor structuredClone prüfen: Klasseninstanzen und Null-Prototyp-Objekte würden
	// dort zu gewöhnlichen Objekten und könnten anschließend unbemerkt Daten verlieren.
	serializeConfigValue(config, '');
	return structuredClone(config) as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string): string {
	const value = source[key];
	return typeof value === 'string' ? value : '';
}

/** Unterscheidet einen vorhandenen (auch leeren) String von einem fehlenden Schlüssel. */
function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	return typeof value === 'string' ? value : undefined;
}

export function isValidWorkerSlug(value: string): boolean {
	return value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function hasReservedWindowsDeviceBasename(value: string): boolean {
	const repository = /^[A-Za-z0-9-]+\/([A-Za-z0-9._-]+)$/.exec(value)?.[1];
	return repository ? /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(repository) : false;
}

export function isValidGithubRepository(value: string): boolean {
	const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(value);
	if (!match) return false;
	const owner = match[1]!;
	const repository = match[2]!;
	return (
		owner.length <= 39 &&
		repository.length <= 100 &&
		!owner.startsWith('-') &&
		!owner.endsWith('-') &&
		!owner.includes('--') &&
		!['.', '..'].includes(repository) &&
		!repository.toLowerCase().endsWith('.git') &&
		// The generated clone directory must remain portable across ordinary Win32 filesystems.
		!hasReservedWindowsDeviceBasename(value)
	);
}

export function githubSlugProperty(value: string): string {
	if (!isValidGithubRepository(value)) {
		throw new Error(`Invalid GitHub repository: ${value}`);
	}
	return `githubSlug: '${value}'`;
}

interface GithubSlugMatch {
	start: number;
	end: number;
	value: string;
}

/**
 * Blendet Kommentare sowie String- und Template-Inhalte aus, behält aber Länge,
 * Zeilenumbrüche und Literalgrenzen. Damit lassen sich die wenigen benötigten
 * Strukturanker bestimmen, ohne beliebige TypeScript-Syntax zu interpretieren.
 */
function maskTypeScriptNonCode(source: string): string {
	const masked = source.split('');
	let index = 0;
	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		if (char === '/' && next === '/') {
			masked[index++] = ' ';
			masked[index++] = ' ';
			while (index < source.length && source[index] !== '\n') masked[index++] = ' ';
			continue;
		}
		if (char === '/' && next === '*') {
			masked[index++] = ' ';
			masked[index++] = ' ';
			while (index < source.length) {
				if (source[index] === '*' && source[index + 1] === '/') {
					masked[index++] = ' ';
					masked[index++] = ' ';
					break;
				}
				if (source[index] !== '\n' && source[index] !== '\r') masked[index] = ' ';
				index += 1;
			}
			continue;
		}
		if (char === "'" || char === '"' || char === '`') {
			const quote = char;
			index += 1;
			while (index < source.length) {
				if (source[index] === '\\') {
					masked[index++] = ' ';
					if (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
						masked[index] = ' ';
					}
					index += 1;
					continue;
				}
				if (source[index] === quote) {
					index += 1;
					break;
				}
				if (source[index] !== '\n' && source[index] !== '\r') masked[index] = ' ';
				index += 1;
			}
			continue;
		}
		index += 1;
	}
	return masked.join('');
}

function findGithubSlugProperty(source: string): GithubSlugMatch {
	const masked = maskTypeScriptNonCode(source);
	const initializers = [...masked.matchAll(/\bexport\s+const\s+SITE_CONFIG\s*=\s*\{/g)];
	if (initializers.length !== 1) {
		throw new Error(
			`Expected exactly one direct SITE_CONFIG initializer in src/lib/config/site.ts, found ${initializers.length}`
		);
	}

	const initializer = initializers[0]!;
	const open = initializer.index + initializer[0].lastIndexOf('{');
	let close = -1;
	let braceDepth = 1;
	for (let index = open + 1; index < masked.length; index += 1) {
		if (masked[index] === '{') braceDepth += 1;
		if (masked[index] === '}') {
			braceDepth -= 1;
			if (braceDepth === 0) {
				close = index;
				break;
			}
		}
	}
	if (close === -1) {
		throw new Error('Could not find the end of SITE_CONFIG in src/lib/config/site.ts');
	}

	const candidates: Array<GithubSlugMatch | undefined> = [];
	let segmentStart = open + 1;
	braceDepth = 1;
	let bracketDepth = 0;
	let parenthesisDepth = 0;
	for (let index = open + 1; index <= close; index += 1) {
		const char = masked[index];
		const atBoundary =
			index === close ||
			(char === ',' && braceDepth === 1 && bracketDepth === 0 && parenthesisDepth === 0);
		if (atBoundary) {
			const segment = masked.slice(segmentStart, index);
			const leading = /^\s*/.exec(segment)![0].length;
			const propertyStart = segmentStart + leading;
			if (
				masked.startsWith('githubSlug', propertyStart) &&
				!/[A-Za-z0-9_$]/.test(masked[propertyStart + 'githubSlug'.length] ?? '')
			) {
				let cursor = propertyStart + 'githubSlug'.length;
				while (/\s/.test(masked[cursor] ?? '')) cursor += 1;
				if (masked[cursor] !== ':') {
					candidates.push(undefined);
				} else {
					cursor += 1;
					while (/\s/.test(masked[cursor] ?? '')) cursor += 1;
					const quote = masked[cursor];
					const literalEnd =
						quote === "'" || quote === '"' ? masked.indexOf(quote, cursor + 1) : -1;
					const trailing = literalEnd === -1 ? '' : masked.slice(literalEnd + 1, index).trim();
					const value = literalEnd === -1 ? '' : source.slice(cursor + 1, literalEnd);
					candidates.push(
						literalEnd !== -1 && trailing === '' && !value.includes('\\')
							? { start: propertyStart, end: literalEnd + 1, value }
							: undefined
					);
				}
			}
			segmentStart = index + 1;
			continue;
		}
		if (char === '{') braceDepth += 1;
		else if (char === '}') braceDepth -= 1;
		else if (char === '[') bracketDepth += 1;
		else if (char === ']') bracketDepth -= 1;
		else if (char === '(') parenthesisDepth += 1;
		else if (char === ')') parenthesisDepth -= 1;
	}

	if (candidates.length === 0) {
		throw new Error('Could not find githubSlug as a direct property in src/lib/config/site.ts');
	}
	if (candidates.length !== 1) {
		throw new Error(
			`Expected exactly one direct githubSlug property in src/lib/config/site.ts, found ${candidates.length}`
		);
	}
	const match = candidates[0];
	if (!match) {
		throw new Error('githubSlug must use a direct string literal in src/lib/config/site.ts');
	}
	return match;
}

export function replaceGithubSlugSource(source: string, value: string): string {
	const replacement = githubSlugProperty(value);
	const match = findGithubSlugProperty(source);
	return source.slice(0, match.start) + replacement + source.slice(match.end);
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
	updated = updated.replace(liveDemoParagraphPattern(), () => '');

	const cloneMatches = updated.match(cloneBlockPattern());
	if (cloneMatches?.length !== 1) {
		throw new Error(
			`Expected exactly one quick start clone block in README.md, found ${cloneMatches?.length ?? 0}`
		);
	}
	updated = updated.replace(
		cloneBlockPattern(),
		// Das gelesene Zeilenende zurückschreiben, damit eine CRLF-Datei CRLF bleibt.
		(_match, lineBreak: string) =>
			`git clone ${githubUrl}.git${lineBreak}cd ./${repositoryBasename}`
	);

	return updated;
}

/**
 * Der Quick-Start-Klonblock. Das Zeilenende wird mitgelesen, damit eine Datei mit
 * CRLF unverändert bleibt.
 */
function cloneBlockPattern(): RegExp {
	return /^(?:gh repo create [^\r\n]*|git clone https:\/\/github\.com\/[^\r\n]*)(\r?\n)cd [^\r\n]*$/gm;
}

function liveDemoParagraphPattern(): RegExp {
	return /^> \[Live demo!\][^\r\n]*(?:\r?\n){2}/m;
}

/**
 * Reports whether the README has the complete generated state for the current
 * repository and legal brand. Manually produced consistent states remain valid.
 */
export function readmeShowsCompletedSetup(
	source: string,
	repository: string,
	brand: string
): boolean {
	const matches = source.match(cloneBlockPattern());
	if (matches?.length !== 1) return false;
	const repositoryBasename = repository.split('/')[1];
	if (!repositoryBasename) return false;
	const [cloneLine, directoryLine] = matches[0]!.split(/\r?\n/);
	if (
		cloneLine !== `git clone https://github.com/${repository}.git` ||
		(directoryLine !== `cd ${repositoryBasename}` && directoryLine !== `cd ./${repositoryBasename}`)
	) {
		return false;
	}

	const heading = /^# .+$/m.exec(source)?.[0];
	return heading === `# ${escapeMarkdownInline(brand)}` && !liveDemoParagraphPattern().test(source);
}

export function replaceWranglerNameSource(source: string, slug: string): string {
	const firstTable = /^[ \t]*\[\[?[^\r\n\]]+\]\]?[ \t]*(?:#.*)?$/m.exec(source);
	const rootEnd = firstTable?.index ?? source.length;
	const root = source.slice(0, rootEnd);
	const pattern = /^name = "[^"]*"/gm;
	const matches = root.match(pattern);
	if (matches?.length !== 1) {
		throw new Error(
			`Expected exactly one name assignment in wrangler.toml, found ${matches?.length ?? 0}`
		);
	}
	return root.replace(pattern, () => `name = ${JSON.stringify(slug)}`) + source.slice(rootEnd);
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
	// Ein vorhandener Wert bleibt erhalten, auch der leere String; nur ein wirklich
	// fehlender Schlüssel bekommt den abgeleiteten Vorschlag.
	const oldCompany = readOptionalString(legalConfig, 'companyName');
	const oldOperator = readString(legalConfig, 'operatorName');
	const oldAddress = readString(legalConfig, 'address');
	const oldUser = readString(legalEmail, 'user');
	const oldDomain = readString(legalEmail, 'domain');
	const oldTld = readString(legalEmail, 'tld');
	const oldEmail = oldUser && oldDomain && oldTld ? `${oldUser}@${oldDomain}.${oldTld}` : '';

	let readmeSource: string;
	try {
		readmeSource = read('README.md');
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	}

	// Der Markenname darf legitim 'SaaS Starter' lauten, und ein von Hand geänderter
	// Package-Name beweist keine Einrichtung. Maßgeblich ist der konsistente README-
	// Endzustand für dieses Repository und die aktuelle rechtliche Marke.
	const alreadySetUp = readmeShowsCompletedSetup(readmeSource, oldRepo, oldBrand);

	if (!interactive && !alreadySetUp) {
		// Solange der Quick Start die Bootstrapform trägt, sind die drei Kernwerte Pflicht.
		// Danach ist nichts mehr Pflicht, auch ein bewusst beibehaltener Template-Slug nicht.
		const missing: string[] = [];
		if (!slugFlag && oldSlug === TEMPLATE_SLUG) missing.push('--slug');
		if (!repoFlag && oldRepo === TEMPLATE_REPOSITORY) missing.push('--repo');
		if (!brandFlag) missing.push('--brand');
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
			isValidWorkerSlug(value)
				? undefined
				: 'slug must match the 1-63 character worker name format (lowercase letters, numbers, inner hyphens)'
	);

	const repo = await resolveValue(repoFlag, 'GitHub repo (owner/name)', oldRepo, (value) => {
		if (hasReservedWindowsDeviceBasename(value)) {
			return 'repo basename must be safe for the generated cross-platform clone directory; Windows device names remain reserved before an extension';
		}
		return isValidGithubRepository(value)
			? undefined
			: 'repo must use a safe GitHub owner/name format';
	});

	const brand = await resolveValue(
		brandFlag,
		'Brand name (display name)',
		// titleCase nur als Vorschlag für das unberührte Template, nie als Ersatz für
		// einen bereits gewählten Namen.
		!alreadySetUp && (oldBrand === '' || oldBrand === TEMPLATE_BRAND) ? titleCase(slug) : oldBrand,
		(value) =>
			value.trim() === '' ? 'brand must not be empty' : legalMarkdownTextValidator('brand')(value)
	);

	const company = await resolveValue(
		companyFlag,
		'Company name (legal entity)',
		oldCompany ?? `${brand} Inc.`
	);

	const operator = await resolveValue(
		operatorFlag,
		'Operator name (person or org running the service)',
		oldOperator,
		legalMarkdownTextValidator('operator')
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
			parseContactEmail(value)
				? undefined
				: `email must use the consumer-compatible user@domain.tld subset without URI separators or encoded localparts, got: ${value}`
	);
	const { user: emailUser, domain: emailDomain, tld: emailTld } = parseContactEmail(email)!;

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
		nextReadme = replaceReadmeSource(readmeSource, {
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
		// Erst wenn alle Inhalte stehen, prüfen, ob jede vorgesehene Datei beschreibbar
		// ist. Sonst schreibt der Lauf die ersten Dateien und scheitert an einer späteren.
		// Das deckt die schreibgeschützte Datei ab; eine Rechteänderung nach dieser
		// Prüfung, ein voller Datenträger und ein Prozessabbruch bleiben außerhalb.
		for (const rel of [
			'package.json',
			...(hasLock ? ['bun.lock'] : []),
			'wrangler.toml',
			'README.md',
			'src/lib/config/site.ts',
			'src/lib/content/legal-metadata.ts',
			'src/lib/config/legal.ts'
		]) {
			try {
				accessSync(join(ROOT, rel), constants.W_OK);
			} catch {
				throw new Error(`Cannot write ${rel}; check file permissions`);
			}
		}
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

	write('src/lib/content/legal-metadata.ts', nextLegalMetadata);
	console.log(
		legalIdentityChanged
			? `  ✓ legal-metadata.ts (Last Updated: ${setupDate})`
			: '  ✓ legal-metadata.ts (unchanged)'
	);

	// Legal config — single source of truth for brand identity
	write('src/lib/config/legal.ts', nextLegalSource);
	console.log('  ✓ legal.ts');

	write('README.md', nextReadme);
	console.log('  ✓ README.md');

	// Site config — single source for runtime repository links
	write('src/lib/config/site.ts', nextSiteConfig);
	console.log('  ✓ site.ts');

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
