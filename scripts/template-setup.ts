/**
 * Template setup script: replaces project-specific placeholders after
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
 * Runs before dependencies are installed: imports are limited to Node built-ins
 * and dependency-free local modules.
 */

import {
	accessSync,
	chmodSync,
	constants,
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmdirSync,
	unlinkSync,
	writeFileSync
} from 'fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'path';
import { createInterface, type Interface } from 'readline';
import { domainToASCII, pathToFileURL } from 'url';
import { parseArgs } from 'util';
import { isIsoCalendarDate } from '../src/lib/content/legal-metadata';

const ROOT = join(import.meta.dirname, '..');

/** Values that still carry the template identity and must be configured. */
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
		// Unknown flags are likely typos and must fail before any file is written.
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
		// Treat Ctrl-C like EOF so the process does not retain an open interface.
		rl.on('SIGINT', () => rl?.close());
	}
	return rl;
}

/** Exits cleanly before mutation and closes any interactive input. */
function fail(message: string): never {
	console.error(`Error: ${message}`);
	rl?.close();
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CanonicalFile {
	rel: string;
	path: string;
	parent: string;
	bytes: Buffer;
	source: string;
	mode: number;
}

interface StagedFile {
	file: CanonicalFile;
	directory: string;
	path: string;
}

const REAL_ROOT = realpathSync(ROOT);

function isWithinRepository(path: string): boolean {
	const fromRoot = relative(REAL_ROOT, path);
	return (
		fromRoot === '' ||
		(!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`))
	);
}

function inspectCanonicalFile(rel: string): CanonicalFile {
	const path = join(ROOT, rel);
	const parent = realpathSync(dirname(path));
	if (!isWithinRepository(parent)) {
		throw new Error(`Refusing ${rel}: real parent is outside the repository root`);
	}
	try {
		accessSync(parent, constants.W_OK);
	} catch {
		throw new Error(`Cannot write parent directory for ${rel}; check directory permissions`);
	}

	const stat = lstatSync(path);
	if (!stat.isFile()) throw new Error(`Refusing ${rel}: canonical target must be a regular file`);
	if (stat.nlink !== 1) {
		throw new Error(`Refusing ${rel}: canonical target must have link count 1, got ${stat.nlink}`);
	}
	try {
		accessSync(path, constants.W_OK);
	} catch {
		throw new Error(`Cannot write ${rel}; check file permissions`);
	}
	const bytes = readFileSync(path);
	return { rel, path, parent, bytes, source: bytes.toString('utf-8'), mode: stat.mode & 0o7777 };
}

function inspectOptionalCanonicalFile(rel: string): CanonicalFile | undefined {
	try {
		return inspectCanonicalFile(rel);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function removeOwnedFile(path: string, errors: string[]): void {
	try {
		unlinkSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			errors.push(`${path}: ${errorMessage(error)}`);
		}
	}
}

function removeOwnedDirectory(path: string, errors: string[]): void {
	try {
		rmdirSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			errors.push(`${path}: ${errorMessage(error)}`);
		}
	}
}

/**
 * Canonical files stay wholly old or new for handled synchronous failures. Process
 * termination, ENOSPC, permission races, concurrent writers, network filesystems, and
 * preservation of owners, ACLs, xattrs, or birthtime remain outside this contract.
 */
function stageFile(file: CanonicalFile, content: string): StagedFile {
	const directory = mkdtempSync(join(file.parent, `.template-setup-${basename(file.path)}-`));
	const path = join(directory, basename(file.path));
	try {
		writeFileSync(path, content, { encoding: 'utf-8', flag: 'wx' });
		chmodSync(path, file.mode);
		return { file, directory, path };
	} catch (error) {
		const cleanupErrors: string[] = [];
		removeOwnedFile(path, cleanupErrors);
		removeOwnedDirectory(directory, cleanupErrors);
		if (cleanupErrors.length > 0) {
			throw new Error(
				`${errorMessage(error)}; staging cleanup failed: ${cleanupErrors.join('; ')}`,
				{ cause: error }
			);
		}
		throw error;
	}
}

function replaceAtomically(file: CanonicalFile, content: string): void {
	const staged = stageFile(file, content);
	try {
		renameSync(staged.path, file.path);
	} catch (error) {
		const cleanupErrors: string[] = [];
		removeOwnedFile(staged.path, cleanupErrors);
		removeOwnedDirectory(staged.directory, cleanupErrors);
		if (cleanupErrors.length > 0) {
			throw new Error(
				`${errorMessage(error)}; staging cleanup failed: ${cleanupErrors.join('; ')}`,
				{ cause: error }
			);
		}
		throw error;
	}

	const cleanupErrors: string[] = [];
	removeOwnedDirectory(staged.directory, cleanupErrors);
	if (cleanupErrors.length > 0) {
		throw new Error(
			`Replacement committed for ${file.rel}, but cleanup failed: ${cleanupErrors.join('; ')}`
		);
	}
}

function canonicalState(file: CanonicalFile): string {
	try {
		const bytes = readFileSync(file.path);
		return bytes.equals(file.bytes) ? 'original' : 'changed';
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable';
	}
}

function assertOriginalBytes(file: CanonicalFile): void {
	const current = readFileSync(file.path);
	if (!current.equals(file.bytes)) {
		throw new Error(`Refusing to replace ${file.rel}: canonical bytes changed after preflight`);
	}
}

type LegalPairState =
	'PREPARED' | 'CONFIG_BACKED_UP' | 'CONFIG_INSTALLED' | 'COMMITTED' | 'RESTORED';

function replaceLegalPair(
	config: CanonicalFile,
	configContent: string,
	metadata: CanonicalFile,
	metadataContent: string
): void {
	const stagedConfig = stageFile(config, configContent);
	let stagedMetadata: StagedFile;
	try {
		stagedMetadata = stageFile(metadata, metadataContent);
	} catch (error) {
		const cleanupErrors: string[] = [];
		removeOwnedFile(stagedConfig.path, cleanupErrors);
		removeOwnedDirectory(stagedConfig.directory, cleanupErrors);
		if (cleanupErrors.length > 0) {
			throw new Error(
				`${errorMessage(error)}; legal staging cleanup failed: ${cleanupErrors.join('; ')}`,
				{ cause: error }
			);
		}
		throw error;
	}

	const backupPath = join(stagedConfig.directory, `${basename(config.path)}.backup`);
	const recoveryPath = join(stagedConfig.directory, `${basename(config.path)}.recovery`);
	let state: LegalPairState = 'PREPARED';
	try {
		assertOriginalBytes(config);
		assertOriginalBytes(metadata);
		renameSync(config.path, backupPath);
		state = 'CONFIG_BACKED_UP';
		renameSync(stagedConfig.path, config.path);
		state = 'CONFIG_INSTALLED';
		renameSync(stagedMetadata.path, metadata.path);
		state = 'COMMITTED';
	} catch (error) {
		if (state === 'CONFIG_BACKED_UP') {
			try {
				renameSync(backupPath, config.path);
				state = 'RESTORED';
			} catch (restoreError) {
				throw new Error(
					`Recovery required after legal pair failure: state=${state}; backup=${backupPath}; ` +
						`recovery=${recoveryPath}; canonical config=${canonicalState(config)}; ` +
						`canonical metadata=${canonicalState(metadata)}; operation failed: ${errorMessage(error)}; ` +
						`restore failed: ${errorMessage(restoreError)}`,
					{ cause: restoreError }
				);
			}
		} else if (state === 'CONFIG_INSTALLED') {
			try {
				renameSync(config.path, recoveryPath);
				renameSync(backupPath, config.path);
				state = 'RESTORED';
			} catch (restoreError) {
				throw new Error(
					`Recovery required after legal pair failure: state=${state}; backup=${backupPath}; ` +
						`recovery=${recoveryPath}; canonical config=${canonicalState(config)}; ` +
						`canonical metadata=${canonicalState(metadata)}; operation failed: ${errorMessage(error)}; ` +
						`restore failed: ${errorMessage(restoreError)}`,
					{ cause: restoreError }
				);
			}
		}

		const cleanupErrors: string[] = [];
		removeOwnedFile(stagedConfig.path, cleanupErrors);
		removeOwnedFile(recoveryPath, cleanupErrors);
		removeOwnedFile(stagedMetadata.path, cleanupErrors);
		removeOwnedDirectory(stagedConfig.directory, cleanupErrors);
		removeOwnedDirectory(stagedMetadata.directory, cleanupErrors);
		if (cleanupErrors.length > 0) {
			throw new Error(
				`${errorMessage(error)}; legal pair state=${state}; cleanup failed: ${cleanupErrors.join('; ')}`,
				{ cause: error }
			);
		}
		throw error;
	}

	const cleanupErrors: string[] = [];
	removeOwnedFile(backupPath, cleanupErrors);
	removeOwnedFile(stagedConfig.path, cleanupErrors);
	removeOwnedFile(stagedMetadata.path, cleanupErrors);
	removeOwnedDirectory(stagedConfig.directory, cleanupErrors);
	removeOwnedDirectory(stagedMetadata.directory, cleanupErrors);
	if (cleanupErrors.length > 0) {
		throw new Error(
			`Legal pair state=${state}; commit completed, but cleanup failed: ${cleanupErrors.join('; ')}`
		);
	}
}

/** Prompts once and returns undefined when stdin closes through EOF, Ctrl-D, or Ctrl-C. */
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

/** Returns a validation message for an unusable value. */
export type Validator = (value: string) => string | undefined;

/** Repeats a prompt until it validates, or returns undefined when input closes. */
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
 * Deliberately narrow subset for existing unencoded mailto consumers. Plus signs,
 * apostrophes, and Unicode letters remain valid; URI separators and local parts that
 * require encoding are rejected. This is not full RFC or deliverability validation.
 */
const EMAIL_LOCAL_PART = /^[\p{L}\p{N}\p{M}._+'-]+$/u;

/** Splits and validates the address without normalizing accepted source parts. */
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
 * Brand and operator values enter Privacy and Terms paragraphs as raw text. A line
 * break would split the paragraph and can create another heading. Address stays multiline.
 */
function singleLineValidator(label: string): Validator {
	return (value) => (/[\r\n]/.test(value) ? `${label} must be a single line` : undefined);
}

// ---------------------------------------------------------------------------
// Safe serialization
// ---------------------------------------------------------------------------

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Emits a TypeScript string literal. JSON.stringify escapes backslashes, control
 * characters, and line breaks before matching Prettier's quote preference for this file.
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

/** Serializes supported values as a TypeScript object while preserving fork-owned keys. */
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

function maskTypeScriptTopLevelCode(source: string): string {
	const masked = source.split('');
	const mask = (index: number): void => {
		if (source[index] !== '\n' && source[index] !== '\r') masked[index] = ' ';
	};

	function consumeQuoted(index: number, quote: "'" | '"'): number {
		mask(index++);
		while (index < source.length) {
			if (source[index] === '\\') {
				mask(index++);
				if (index >= source.length) break;
				mask(index++);
				continue;
			}
			if (source[index] === quote) {
				mask(index++);
				return index;
			}
			if (source[index] === '\n' || source[index] === '\r') {
				throw new Error('Unsupported unterminated string in src/lib/config/legal.ts');
			}
			mask(index++);
		}
		throw new Error('Unsupported unterminated string in src/lib/config/legal.ts');
	}

	function consumeLineComment(index: number): number {
		mask(index++);
		mask(index++);
		while (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
			mask(index++);
		}
		return index;
	}

	function consumeBlockComment(index: number): number {
		mask(index++);
		mask(index++);
		while (index < source.length) {
			if (source[index] === '*' && source[index + 1] === '/') {
				mask(index++);
				mask(index++);
				return index;
			}
			mask(index++);
		}
		throw new Error('Unsupported unterminated block comment in src/lib/config/legal.ts');
	}

	function consumeTemplateInterpolation(index: number): number {
		let depth = 1;
		while (index < source.length) {
			const char = source[index];
			const next = source[index + 1];
			if (char === "'" || char === '"') {
				index = consumeQuoted(index, char);
				continue;
			}
			if (char === '`') {
				index = consumeTemplate(index);
				continue;
			}
			if (char === '/' && next === '/') {
				index = consumeLineComment(index);
				continue;
			}
			if (char === '/' && next === '*') {
				index = consumeBlockComment(index);
				continue;
			}
			if (char === '/') {
				throw new Error('Unsupported slash syntax in template interpolation in legal.ts');
			}
			if (char === '{') depth += 1;
			if (char === '}') {
				depth -= 1;
				mask(index++);
				if (depth === 0) return index;
				continue;
			}
			mask(index++);
		}
		throw new Error('Unsupported unterminated template interpolation in legal.ts');
	}

	function consumeTemplate(index: number): number {
		mask(index++);
		while (index < source.length) {
			if (source[index] === '\\') {
				mask(index++);
				if (index >= source.length) break;
				mask(index++);
				continue;
			}
			if (source[index] === '`') {
				mask(index++);
				return index;
			}
			if (source[index] === '$' && source[index + 1] === '{') {
				mask(index++);
				mask(index++);
				index = consumeTemplateInterpolation(index);
				continue;
			}
			mask(index++);
		}
		throw new Error('Unsupported unterminated template in src/lib/config/legal.ts');
	}

	let index = 0;
	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];
		if (char === "'" || char === '"') {
			index = consumeQuoted(index, char);
			continue;
		}
		if (char === '`') {
			index = consumeTemplate(index);
			continue;
		}
		if (char === '/' && next === '/') {
			index = consumeLineComment(index);
			continue;
		}
		if (char === '/' && next === '*') {
			index = consumeBlockComment(index);
			continue;
		}
		if (char === '/') {
			throw new Error('Unsupported slash syntax in src/lib/config/legal.ts');
		}
		index += 1;
	}
	return masked.join('');
}

interface LegalConfigSourceMatch {
	start: number;
	end: number;
}

function findLegalConfigSource(source: string): LegalConfigSourceMatch {
	const masked = maskTypeScriptTopLevelCode(source);
	const topLevel = new Set<number>();
	let braceDepth = 0;
	let bracketDepth = 0;
	let parenthesisDepth = 0;
	for (let index = 0; index < masked.length; index += 1) {
		if (braceDepth === 0 && bracketDepth === 0 && parenthesisDepth === 0) topLevel.add(index);
		if (masked[index] === '{') braceDepth += 1;
		else if (masked[index] === '}') braceDepth -= 1;
		else if (masked[index] === '[') bracketDepth += 1;
		else if (masked[index] === ']') bracketDepth -= 1;
		else if (masked[index] === '(') parenthesisDepth += 1;
		else if (masked[index] === ')') parenthesisDepth -= 1;
		if (braceDepth < 0 || bracketDepth < 0 || parenthesisDepth < 0) {
			throw new Error('Unsupported unbalanced syntax in src/lib/config/legal.ts');
		}
	}
	if (braceDepth !== 0 || bracketDepth !== 0 || parenthesisDepth !== 0) {
		throw new Error('Unsupported unbalanced syntax in src/lib/config/legal.ts');
	}

	const declarations = [...masked.matchAll(/\bexport\s+const\s+LEGAL_CONFIG\b/g)].filter(
		(match) => match.index !== undefined && topLevel.has(match.index)
	);
	if (declarations.length !== 1) {
		throw new Error(
			`Expected exactly one LEGAL_CONFIG export in src/lib/config/legal.ts, found ${declarations.length}`
		);
	}

	const declaration = declarations[0]!;
	let cursor = declaration.index + declaration[0].length;
	while (/\s/.test(masked[cursor] ?? '')) cursor += 1;
	if (masked[cursor++] !== '=') {
		throw new Error('LEGAL_CONFIG must use a direct object initializer followed by as const;');
	}
	while (/\s/.test(masked[cursor] ?? '')) cursor += 1;
	if (masked[cursor] !== '{') {
		throw new Error('LEGAL_CONFIG must use a direct object initializer followed by as const;');
	}

	let objectDepth = 1;
	let close = cursor + 1;
	for (; close < masked.length; close += 1) {
		if (masked[close] === '{') objectDepth += 1;
		if (masked[close] === '}') {
			objectDepth -= 1;
			if (objectDepth === 0) break;
		}
	}
	if (objectDepth !== 0) throw new Error('Could not find the end of LEGAL_CONFIG');

	const suffix = /^\s+as\s+const\s*;/.exec(masked.slice(close + 1));
	if (!suffix) {
		throw new Error('LEGAL_CONFIG must use a direct object initializer followed by as const;');
	}
	return { start: declaration.index, end: close + 1 + suffix[0].length };
}

/** Replaces the one supported top-level LEGAL_CONFIG initializer. */
export function replaceLegalConfigSource(source: string, config: Record<string, unknown>): string {
	const match = findLegalConfigSource(source);
	const block = `export const LEGAL_CONFIG = ${serializeConfigValue(config, '')} as const;`;
	return source.slice(0, match.start) + block + source.slice(match.end);
}

// ---------------------------------------------------------------------------
// Detect current values (for re-run defaults)
// ---------------------------------------------------------------------------

function currentSlug(source: string): string {
	const pkg = JSON.parse(source);
	return pkg.name ?? TEMPLATE_SLUG;
}

function currentRepo(source: string): string {
	return findGithubSlugProperty(source).value;
}

/** Reads legal defaults from the real module and validates the supported data shape. */
async function readLegalConfig(file: CanonicalFile): Promise<Record<string, unknown>> {
	const imported = (await import(pathToFileURL(file.path).href)) as {
		LEGAL_CONFIG?: unknown;
	};
	assertOriginalBytes(file);
	const config = imported.LEGAL_CONFIG;
	if (config === null || typeof config !== 'object' || Array.isArray(config)) {
		throw new Error('Could not read LEGAL_CONFIG from src/lib/config/legal.ts');
	}
	// Validate before structuredClone can normalize class instances or null-prototype objects.
	serializeConfigValue(config, '');
	return structuredClone(config) as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string): string {
	const value = source[key];
	return typeof value === 'string' ? value : '';
}

/** Distinguishes an existing string, including empty, from a missing key. */
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
		!repository.endsWith('.') &&
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
 * Masks comments, strings, and template contents while retaining offsets and line
 * breaks. The remaining code supports the few required anchors without parsing TypeScript.
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

interface LegalContentDateMatch {
	start: number;
	end: number;
	quote: "'" | '"';
}

function findLegalContentDateProperties(source: string): LegalContentDateMatch[] {
	const masked = maskTypeScriptNonCode(source);
	const initializers = [
		...masked.matchAll(/^export[ \t]+const[ \t]+LEGAL_CONTENT_DATES[ \t]*=[ \t]*\{/gm)
	];
	if (initializers.length !== 1) {
		throw new Error('Could not update every date in src/lib/content/legal-metadata.ts');
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
		throw new Error('Could not update every date in src/lib/content/legal-metadata.ts');
	}

	const expected = new Set(['privacy', 'terms', 'impressum']);
	const matches = new Map<string, LegalContentDateMatch[]>();
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
			const key = /^(privacy|terms|impressum)\b/.exec(masked.slice(propertyStart))?.[1];
			if (key && expected.has(key)) {
				const keyMatches = matches.get(key) ?? [];
				matches.set(key, keyMatches);
				let cursor = propertyStart + key.length;
				while (/\s/.test(masked[cursor] ?? '')) cursor += 1;
				if (masked[cursor] !== ':') {
					keyMatches.push({ start: -1, end: -1, quote: "'" });
				} else {
					cursor += 1;
					while (/\s/.test(masked[cursor] ?? '')) cursor += 1;
					const quote = masked[cursor];
					if (quote !== "'" && quote !== '"') {
						keyMatches.push({ start: -1, end: -1, quote: "'" });
					} else {
						const literalEnd = masked.indexOf(quote, cursor + 1);
						const literal = literalEnd === -1 ? '' : source.slice(cursor + 1, literalEnd);
						const trailing = literalEnd === -1 ? '' : masked.slice(literalEnd + 1, index).trim();
						keyMatches.push(
							literalEnd !== -1 &&
								trailing === '' &&
								!literal.includes('\\') &&
								isIsoCalendarDate(literal)
								? { start: cursor, end: literalEnd + 1, quote }
								: { start: -1, end: -1, quote: "'" }
						);
					}
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

	const properties = [...expected].flatMap((key) => matches.get(key) ?? []);
	if (
		properties.length !== expected.size ||
		[...expected].some((key) => matches.get(key)?.length !== 1) ||
		properties.some(({ start }) => start === -1)
	) {
		throw new Error('Could not update every date in src/lib/content/legal-metadata.ts');
	}
	return properties;
}

export function replaceLegalContentDatesSource(source: string, value: string): string {
	if (!isIsoCalendarDate(value)) throw new Error(`Invalid legal content date: ${value}`);
	const properties = findLegalContentDateProperties(source).sort(
		(left, right) => right.start - left.start
	);
	return properties.reduce(
		(updated, property) =>
			updated.slice(0, property.start) +
			property.quote +
			value +
			property.quote +
			updated.slice(property.end),
		source
	);
}

export function updateLegalContentDatesSource(
	source: string,
	value: string,
	legalIdentityChanged: boolean
): string {
	if (legalIdentityChanged) return replaceLegalContentDatesSource(source, value);
	findLegalContentDateProperties(source);
	return source;
}

// ---------------------------------------------------------------------------
// README, wrangler, lockfile
// ---------------------------------------------------------------------------

/** Escapes characters that would change the literal rendering of a Markdown heading. */
export function escapeMarkdownInline(value: string): string {
	return value.replace(/[\\`*_[\]<>&#~]/g, (char) => `\\${char}`);
}

interface MarkdownLine {
	start: number;
	end: number;
	fullEnd: number;
	content: string;
	lineBreak: '' | '\n' | '\r\n';
}

interface MarkdownFence {
	openLine: number;
	closeLine: number;
	marker: '`' | '~';
	length: number;
	info: string;
}

interface MarkdownHeading {
	line: number;
	level: number;
	text: string;
}

interface QuickStartCandidate {
	cloneLine: MarkdownLine;
	directoryLine: MarkdownLine;
	clone: string;
	directory: string;
}

interface ReadmeStructure {
	lines: MarkdownLine[];
	fences: MarkdownFence[];
	headings: MarkdownHeading[];
	candidate: QuickStartCandidate;
}

function markdownLines(source: string): MarkdownLine[] {
	const lines: MarkdownLine[] = [];
	let start = 0;
	while (start < source.length) {
		const lf = source.indexOf('\n', start);
		if (lf === -1) {
			lines.push({
				start,
				end: source.length,
				fullEnd: source.length,
				content: source.slice(start),
				lineBreak: ''
			});
			return lines;
		}
		const crlf = lf > start && source[lf - 1] === '\r';
		const end = crlf ? lf - 1 : lf;
		lines.push({
			start,
			end,
			fullEnd: lf + 1,
			content: source.slice(start, end),
			lineBreak: crlf ? '\r\n' : '\n'
		});
		start = lf + 1;
	}
	if (source === '' || source.endsWith('\n')) {
		lines.push({ start, end: start, fullEnd: start, content: '', lineBreak: '' });
	}
	return lines;
}

function openingFence(
	line: string
): { marker: '`' | '~'; length: number; info: string } | undefined {
	const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
	if (!match) return undefined;
	const marker = match[1]![0] as '`' | '~';
	const info = match[2]!.trim();
	if (marker === '`' && info.includes('`')) return undefined;
	return { marker, length: match[1]!.length, info };
}

function closesFence(line: string, fence: { marker: '`' | '~'; length: number }): boolean {
	const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
	return !!match && match[1]![0] === fence.marker && match[1]!.length >= fence.length;
}

function markdownHeading(line: string): { level: number; text: string } | undefined {
	const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
	if (!match) return undefined;
	const text = (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
	return { level: match[1]!.length, text };
}

function installationCandidate(lines: MarkdownLine[]): QuickStartCandidate | undefined {
	if (
		lines.length !== 4 ||
		lines[2]!.content !== 'bun install' ||
		lines[3]!.content !== 'bun run dev'
	) {
		return undefined;
	}
	const clone = lines[0]!.content;
	const directory = lines[1]!.content;
	const git = /^git clone https:\/\/github\.com\/[A-Za-z0-9-]+\/([A-Za-z0-9._-]+)\.git$/.exec(
		clone
	);
	if (git) {
		const expected = git[1]!;
		if (directory !== `cd ${expected}` && directory !== `cd ./${expected}`) return undefined;
		return { cloneLine: lines[0]!, directoryLine: lines[1]!, clone, directory };
	}
	const bootstrap =
		/^gh repo create ([A-Za-z0-9._-]+) --template [A-Za-z0-9-]+\/[A-Za-z0-9._-]+ --clone$/.exec(
			clone
		);
	if (!bootstrap || (directory !== `cd ${bootstrap[1]}` && directory !== `cd ./${bootstrap[1]}`)) {
		return undefined;
	}
	return { cloneLine: lines[0]!, directoryLine: lines[1]!, clone, directory };
}

function findReadmeStructure(source: string): ReadmeStructure {
	const lines = markdownLines(source);
	const fences: MarkdownFence[] = [];
	const headings: MarkdownHeading[] = [];
	let open: { line: number; marker: '`' | '~'; length: number; info: string } | undefined;
	for (let index = 0; index < lines.length; index += 1) {
		const content = lines[index]!.content;
		if (open) {
			if (closesFence(content, open)) {
				fences.push({
					openLine: open.line,
					closeLine: index,
					marker: open.marker,
					length: open.length,
					info: open.info
				});
				open = undefined;
			}
			continue;
		}
		const fence = openingFence(content);
		if (fence) {
			open = { line: index, ...fence };
			continue;
		}
		const heading = markdownHeading(content);
		if (heading) headings.push({ line: index, ...heading });
	}
	if (open) throw new Error('README.md contains an unterminated fenced code block');

	const quickStarts = headings.filter(({ level, text }) => level === 2 && text === 'Quick Start');
	if (quickStarts.length !== 1) {
		throw new Error(
			`Expected exactly one Quick Start H2 in README.md, found ${quickStarts.length}`
		);
	}
	const quickStart = quickStarts[0]!;
	const nextSection = headings.find(
		({ line, level }) => line > quickStart.line && (level === 1 || level === 2)
	);
	const sectionEnd = nextSection?.line ?? lines.length;
	const candidates = fences
		.filter(
			({ openLine, closeLine, info }) =>
				openLine > quickStart.line && closeLine < sectionEnd && info.toLowerCase() === 'bash'
		)
		.map(({ openLine, closeLine }) => installationCandidate(lines.slice(openLine + 1, closeLine)))
		.filter((candidate): candidate is QuickStartCandidate => candidate !== undefined);
	if (candidates.length !== 1) {
		throw new Error(
			`Expected exactly one Quick Start installation candidate in README.md, found ${candidates.length}`
		);
	}
	const candidate = candidates[0]!;
	const cloneLine = lines.indexOf(candidate.cloneLine);
	const candidateLineBreaks = new Set(
		lines
			.slice(cloneLine - 1, cloneLine + 5)
			.map(({ lineBreak }) => lineBreak)
			.filter((lineBreak) => lineBreak !== '')
	);
	if (candidateLineBreaks.size > 1) throw new Error('Quick Start contains mixed line endings');
	return { lines, fences, headings, candidate };
}

function repositorySentencePeriodBoundary(source: string, period: number): boolean {
	let cursor = period + 1;
	const afterPeriod = source[cursor];
	if (afterPeriod === undefined || /\s/.test(afterPeriod)) return true;

	const closing = /^[\])}"'’”]+/.exec(source.slice(cursor));
	if (!closing) return false;
	cursor += closing[0].length;
	const afterClosing = source[cursor];
	return afterClosing === undefined || /[\s,;:!?]/.test(afterClosing);
}

function repositoryUrlBoundary(source: string, end: number): boolean {
	const next = source[end];
	if (next === undefined) return true;
	if (source.startsWith('.git', end)) {
		const afterGit = source[end + 4];
		if (afterGit === '.') return repositorySentencePeriodBoundary(source, end + 4);
		return afterGit === undefined || !/[A-Za-z0-9._-]/.test(afterGit);
	}
	if (next === '.') return repositorySentencePeriodBoundary(source, end);
	return !/[A-Za-z0-9._-]/.test(next);
}

function replaceGithubRepositoryUrls(
	source: string,
	oldGithubUrl: string,
	githubUrl: string,
	excluded: Array<{ start: number; end: number }>
): string {
	let updated = '';
	let cursor = 0;
	for (;;) {
		const start = source.indexOf(oldGithubUrl, cursor);
		if (start === -1) return updated + source.slice(cursor);
		const end = start + oldGithubUrl.length;
		const protectedRange = excluded.some((range) => start >= range.start && start < range.end);
		updated += source.slice(cursor, start);
		updated += !protectedRange && repositoryUrlBoundary(source, end) ? githubUrl : oldGithubUrl;
		cursor = end;
	}
}

/** Updates the heading, template demo paragraph, repository URLs, and exact Quick Start candidate. */
export function replaceReadmeSource(
	source: string,
	options: { brand: string; repository: string; oldGithubUrl: string; githubUrl: string }
): string {
	const { brand, repository, oldGithubUrl, githubUrl } = options;
	const repositoryBasename = repository.split('/')[1]!;
	const structure = findReadmeStructure(source);
	const { cloneLine, directoryLine } = structure.candidate;
	let updated =
		source.slice(0, cloneLine.start) +
		`git clone ${githubUrl}.git${cloneLine.lineBreak}cd ./${repositoryBasename}` +
		source.slice(directoryLine.end);

	if (oldGithubUrl !== githubUrl) {
		const updatedStructure = findReadmeStructure(updated);
		const excluded = updatedStructure.fences.map(({ openLine, closeLine }) => ({
			start: updatedStructure.lines[openLine]!.start,
			end: updatedStructure.lines[closeLine]!.fullEnd
		}));
		updated = replaceGithubRepositoryUrls(updated, oldGithubUrl, githubUrl, excluded);
	}
	updated = removeTemplateLiveDemoParagraph(updated, findReadmeStructure(updated));

	const finalStructure = findReadmeStructure(updated);
	const heading = finalStructure.headings.find(({ level }) => level === 1);
	if (!heading) throw new Error('Could not find the top-level heading in README.md');
	const headingLine = finalStructure.lines[heading.line]!;
	updated =
		updated.slice(0, headingLine.start) +
		`# ${escapeMarkdownInline(brand)}` +
		updated.slice(headingLine.end);
	return updated;
}

function liveDemoParagraphPattern(): RegExp {
	return /^> \[Live demo!\][^\r\n]*(?:\r?\n){2}/gm;
}

function liveDemoParagraphRanges(
	source: string,
	structure: ReadmeStructure
): Array<{ start: number; end: number }> {
	const fences = structure.fences.map(({ openLine, closeLine }) => ({
		start: structure.lines[openLine]!.start,
		end: structure.lines[closeLine]!.fullEnd
	}));
	return [...source.matchAll(liveDemoParagraphPattern())].flatMap((match) => {
		const start = match.index;
		if (start === undefined || fences.some((range) => start >= range.start && start < range.end)) {
			return [];
		}
		return [{ start, end: start + match[0].length }];
	});
}

function removeTemplateLiveDemoParagraph(source: string, structure: ReadmeStructure): string {
	const matches = liveDemoParagraphRanges(source, structure);
	if (matches.length > 1) {
		throw new Error(
			`Expected at most one live demo paragraph outside fences in README.md, found ${matches.length}`
		);
	}
	const match = matches[0];
	return match ? source.slice(0, match.start) + source.slice(match.end) : source;
}

/** Reports whether the README carries the generated identity in the exact Quick Start section. */
export function readmeShowsCompletedSetup(
	source: string,
	repository: string,
	brand: string
): boolean {
	let structure: ReadmeStructure;
	try {
		structure = findReadmeStructure(source);
	} catch {
		return false;
	}
	const repositoryBasename = repository.split('/')[1];
	if (!repositoryBasename) return false;
	const { clone, directory } = structure.candidate;
	if (
		clone !== `git clone https://github.com/${repository}.git` ||
		(directory !== `cd ${repositoryBasename}` && directory !== `cd ./${repositoryBasename}`)
	) {
		return false;
	}
	const heading = structure.headings.find(({ level }) => level === 1);
	return (
		heading?.text === escapeMarkdownInline(brand) &&
		liveDemoParagraphRanges(source, structure).length === 0
	);
}

function maskTomlNonCode(source: string): string {
	const masked = source.split('');
	let index = 0;
	while (index < source.length) {
		if (source[index] === '#') {
			while (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
				masked[index++] = ' ';
			}
			continue;
		}

		const quote = source[index];
		if (quote !== "'" && quote !== '"') {
			index += 1;
			continue;
		}
		const multiline = source.startsWith(quote.repeat(3), index);
		const delimiterLength = multiline ? 3 : 1;
		index += delimiterLength;
		let closed = false;
		while (index < source.length) {
			if (multiline && source.startsWith(quote.repeat(3), index)) {
				index += 3;
				closed = true;
				break;
			}
			if (!multiline && source[index] === quote) {
				index += 1;
				closed = true;
				break;
			}
			if (!multiline && (source[index] === '\n' || source[index] === '\r')) break;
			if (quote === '"' && source[index] === '\\') {
				masked[index++] = ' ';
				if (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
					masked[index] = ' ';
				}
				index += 1;
				continue;
			}
			if (source[index] !== '\n' && source[index] !== '\r') masked[index] = ' ';
			index += 1;
		}
		if (!closed) throw new Error('Unsupported or unterminated string in wrangler.toml');
	}
	return masked.join('');
}

export function replaceWranglerNameSource(source: string, slug: string): string {
	const masked = maskTomlNonCode(source);
	const firstTable = /^[ \t]*\[\[?[^\r\n\]]+\]\]?[ \t]*$/m.exec(masked);
	const rootEnd = firstTable?.index ?? source.length;
	const root = masked.slice(0, rootEnd);
	const pattern = /^[ \t]*name[ \t]*=[ \t]*"[^"\r\n]*"[ \t]*(?=\r?$)/gm;
	const matches = [...root.matchAll(pattern)];
	if (matches.length !== 1) {
		throw new Error(
			`Expected exactly one name assignment in wrangler.toml, found ${matches.length}`
		);
	}
	const match = matches[0]!;
	const assignmentStart = match.index;
	const literalStart = masked.indexOf('"', assignmentStart);
	const literalEnd = masked.indexOf('"', literalStart + 1) + 1;
	return source.slice(0, literalStart) + JSON.stringify(slug) + source.slice(literalEnd);
}

/** Synchronizes only the lockfile root name without recalculating dependencies. */
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

	let packageFile: CanonicalFile;
	let lockFile: CanonicalFile | undefined;
	let wranglerFile: CanonicalFile;
	let readmeFile: CanonicalFile;
	let siteFile: CanonicalFile;
	let legalConfigFile: CanonicalFile;
	let legalMetadataFile: CanonicalFile;
	try {
		packageFile = inspectCanonicalFile('package.json');
		lockFile = inspectOptionalCanonicalFile('bun.lock');
		wranglerFile = inspectCanonicalFile('wrangler.toml');
		readmeFile = inspectCanonicalFile('README.md');
		siteFile = inspectCanonicalFile('src/lib/config/site.ts');
		legalConfigFile = inspectCanonicalFile('src/lib/config/legal.ts');
		legalMetadataFile = inspectCanonicalFile('src/lib/content/legal-metadata.ts');
	} catch (error) {
		fail(errorMessage(error));
	}

	const legalConfig = await readLegalConfig(legalConfigFile).catch((error: unknown) =>
		fail(errorMessage(error))
	);
	const legalEmail = (legalConfig.email ?? {}) as Record<string, unknown>;
	const oldSlug = currentSlug(packageFile.source);
	const oldRepo = currentRepo(siteFile.source);
	const oldBrand = readString(legalConfig, 'brandName');
	// Preserve an existing string, including an empty one. Only a missing key gets a suggestion.
	const oldCompany = readOptionalString(legalConfig, 'companyName');
	const oldOperator = readString(legalConfig, 'operatorName');
	const oldAddress = readString(legalConfig, 'address');
	const oldUser = readString(legalEmail, 'user');
	const oldDomain = readString(legalEmail, 'domain');
	const oldTld = readString(legalEmail, 'tld');
	const oldEmail = oldUser && oldDomain && oldTld ? `${oldUser}@${oldDomain}.${oldTld}` : '';

	// A chosen template brand and hand-edited package name are valid only with a complete README state.
	const alreadySetUp = readmeShowsCompletedSetup(readmeFile.source, oldRepo, oldBrand);

	if (!interactive && !alreadySetUp) {
		// The three core values remain required until Quick Start carries the generated form.
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
		// Use titleCase only as a suggestion for the untouched template identity.
		!alreadySetUp && (oldBrand === '' || oldBrand === TEMPLATE_BRAND) ? titleCase(slug) : oldBrand,
		(value) =>
			value.trim() === '' ? 'brand must not be empty' : singleLineValidator('brand')(value)
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
		singleLineValidator('operator')
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

	// Compute every next canonical value before creating a staging directory.
	const nextLegalConfig = { ...legalConfig };
	nextLegalConfig.brandName = brand;
	nextLegalConfig.companyName = company;
	nextLegalConfig.operatorName = operator;
	nextLegalConfig.address = address;
	nextLegalConfig.email = { ...legalEmail, user: emailUser, domain: emailDomain, tld: emailTld };

	let nextPackageJson: string;
	let nextWrangler: string;
	let nextReadme: string;
	let nextSiteConfig: string;
	let nextLegalMetadata: string;
	let nextLegalSource: string;
	let nextLock: string | undefined;
	try {
		const pkg = JSON.parse(packageFile.source);
		pkg.name = slug;
		pkg.author = operator;
		nextPackageJson = JSON.stringify(pkg, null, '\t') + '\n';
		nextWrangler = replaceWranglerNameSource(wranglerFile.source, slug);
		nextReadme = replaceReadmeSource(readmeFile.source, {
			brand,
			repository: repo,
			oldGithubUrl,
			githubUrl
		});
		nextSiteConfig = replaceGithubSlugSource(siteFile.source, repo);
		nextLegalMetadata = updateLegalContentDatesSource(
			legalMetadataFile.source,
			setupDate,
			legalIdentityChanged
		);
		nextLegalSource = replaceLegalConfigSource(legalConfigFile.source, nextLegalConfig);
		nextLock = lockFile ? replaceLockRootNameSource(lockFile.source, slug) : undefined;
	} catch (error) {
		fail(errorMessage(error));
	}

	console.log(`\nApplying: slug=${slug}, repo=${repo}, brand="${brand}"\n`);

	replaceLegalPair(legalConfigFile, nextLegalSource, legalMetadataFile, nextLegalMetadata);
	console.log('  ✓ legal.ts');
	console.log(
		legalIdentityChanged
			? `  ✓ legal-metadata.ts (Last Updated: ${setupDate})`
			: '  ✓ legal-metadata.ts (unchanged)'
	);

	replaceAtomically(packageFile, nextPackageJson);
	console.log('  ✓ package.json');

	if (lockFile && nextLock !== undefined) {
		replaceAtomically(lockFile, nextLock);
		console.log('  ✓ bun.lock (root name)');
	}

	replaceAtomically(wranglerFile, nextWrangler);
	console.log('  ✓ wrangler.toml');

	replaceAtomically(readmeFile, nextReadme);
	console.log('  ✓ README.md');

	replaceAtomically(siteFile, nextSiteConfig);
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
