/**
 * Reject control and bidi characters before any checker reads the working tree.
 *
 * `local/no-literal-control-char` sees only files a parser accepts. Prettier instead
 * builds a parse-error code frame from the original source: the failing line plus two
 * above and three below. A raw ESC anywhere in that window reaches the terminal as an
 * escape introducer, and a bidi control reorders what the developer reads. The
 * character does not have to cause the syntax error. Measured against Prettier 3.9.5
 * for JavaScript, TypeScript, Svelte, JSON and CSS, and tracked as issue #832.
 *
 * Output filtering cannot distinguish a CSI copied from source from the byte-identical
 * CSI Prettier emits for colour. This scan runs before the first child process instead,
 * leaving native output intact. Editors still use the ESLint rule directly; both paths
 * import the same closed set from `eslint/control-character-policy.js`.
 */

import { createReadStream, lstatSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
	createLiteralControlCharacterScanner,
	findDiagnosticControlCharacters,
	sanitizeDiagnosticField
} from '../eslint/control-character-policy.js';

interface CharacterFinding {
	kind: 'character';
	/** Repo-relative and already safe to print. */
	file: string;
	line: number;
	/** One-based, for the `file:line:column` convention every editor jumps to. */
	column: number;
	codepoint: string;
	category: string;
	escape: string;
}

interface EncodingFinding {
	kind: 'encoding';
	/** Repo-relative and already safe to print. */
	file: string;
}

interface UnreadableFinding {
	kind: 'unreadable';
	/** Repo-relative and already safe to print. */
	file: string;
}

interface OmittedFinding {
	kind: 'omitted';
}

export type SourceSafetyFinding =
	CharacterFinding | EncodingFinding | UnreadableFinding | OmittedFinding;

/** Dependency and generated directories skipped wherever they occur. */
const SKIP_ANYWHERE = new Set(['.git', '.svelte-kit', '.convex', 'node_modules']);

/** Tool output directories skipped only at the repository root. */
const SKIP_AT_ROOT = new Set(['.output', '.wrangler', 'build', 'dist', 'coverage', 'references']);

/** Text formats a project checker can parse or quote. Every filename stays in scope. */
const TEXT_EXTENSIONS = new Set([
	'.astro',
	'.cjs',
	'.cts',
	'.css',
	'.env',
	'.example',
	'.gql',
	'.graphql',
	'.htm',
	'.html',
	'.js',
	'.json',
	'.json5',
	'.jsonc',
	'.jsx',
	'.less',
	'.lock',
	'.md',
	'.mdc',
	'.mdx',
	'.mjs',
	'.mts',
	'.patch',
	'.prettierrc',
	'.schema',
	'.scss',
	'.snap',
	'.svelte',
	'.svg',
	'.toml',
	'.ts',
	'.tsx',
	'.txt',
	'.vue',
	'.webmanifest',
	'.xml',
	'.yaml',
	'.yml'
]);
const TEXT_NAMES = new Set([
	'.assetsignore',
	'.gitattributes',
	'.gitignore',
	'.npmrc',
	'.prettierignore',
	'.prettierrc',
	'.tolgeerc',
	'_headers'
]);

/**
 * Known generated text with intentional bidi controls.
 *
 * `better-svelte-email` pads inbox preview text with LRM and RLM. Its committed
 * snapshot and ignored generated templates carry those marks repeatedly. Prettier
 * 3.9.5 reports no parser for that snapshot; the templates are created later by
 * `build-emails`. Their authored templates and every filename remain checked.
 */
const EMAIL_SNAPSHOT = 'src/lib/emails/__tests__/__snapshots__/email-snapshots.test.ts.snap';

/** Whether a file's bytes are source text. File names never use this exemption. */
export function shouldScanContents(file: string): boolean {
	if (file === EMAIL_SNAPSHOT || file.startsWith('src/lib/emails/generated/')) return false;
	const name = path.posix.basename(file);
	return TEXT_NAMES.has(name) || TEXT_EXTENSIONS.has(path.posix.extname(file).toLowerCase());
}

/**
 * Every ordinary file below the repository root, independent of Git's ignore stack.
 *
 * Prettier honors the repository `.gitignore`, while Git's `--exclude-standard` also
 * honors `.git/info/exclude` and the developer's global excludes. Building the file
 * set through Git therefore misses files that `prettier .` still parses. A byte-level
 * directory walk includes those files, rejects undecodable names before printing them,
 * and does not follow symlinks into another tree.
 */
export function inventory(root: string): string[] {
	const files: string[] = [];
	const decoder = new TextDecoder('utf-8', { fatal: true });

	function walk(absolute: string, relative: string[]): void {
		let names: Uint8Array[];
		try {
			names = readdirSync(absolute, { encoding: 'buffer' }) as unknown as Uint8Array[];
		} catch {
			console.error('Source safety: could not read a directory in the working tree');
			process.exit(1);
		}

		for (const rawName of names) {
			let name: string;
			try {
				name = decoder.decode(rawName);
			} catch {
				console.error(
					'Source safety: a path in this repository is not valid UTF-8, so it cannot be checked or safely printed'
				);
				process.exit(1);
			}

			const nextRelative = [...relative, name];
			const nextAbsolute = path.join(absolute, name);
			let stat;
			try {
				stat = lstatSync(nextAbsolute);
			} catch (error) {
				if (isMissing(error)) continue;
				console.error('Source safety: could not inspect an entry in the working tree');
				process.exit(1);
			}
			if (stat.isSymbolicLink()) {
				files.push(nextRelative.join('/'));
				continue;
			}
			if (stat.isDirectory()) {
				const skip = SKIP_ANYWHERE.has(name) || (relative.length === 0 && SKIP_AT_ROOT.has(name));
				if (!skip) walk(nextAbsolute, nextRelative);
				continue;
			}
			if (stat.isFile()) files.push(nextRelative.join('/'));
		}
	}

	walk(path.resolve(root), []);
	return files.sort();
}

/** The report is bounded in memory as well as on screen. */
const REPORT_LIMIT = 20;
const RETAINED_FINDINGS = REPORT_LIMIT + 1;

/** Findings in a file name, which uses a stricter policy than source structure. */
function scanFileName(file: string): CharacterFinding[] {
	const safeName = sanitizeDiagnosticField(file);
	return findDiagnosticControlCharacters(file)
		.slice(0, RETAINED_FINDINGS)
		.map((found) => ({
			kind: 'character',
			file: safeName,
			line: 0,
			column: 0,
			...found.data
		}));
}

export function isMissing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Findings for one file, read incrementally so one large input cannot double memory use. */
export async function scanFile(file: string, root: string): Promise<SourceSafetyFinding[]> {
	const safeName = sanitizeDiagnosticField(file);
	const findings: SourceSafetyFinding[] = scanFileName(file);
	if (!shouldScanContents(file)) return findings;
	try {
		if (lstatSync(path.resolve(root, file)).isSymbolicLink()) return findings;
	} catch (error) {
		if (isMissing(error)) return findings;
		return [...findings, { kind: 'unreadable', file: safeName }];
	}

	const scanner = createLiteralControlCharacterScanner((found) => {
		if (findings.length >= RETAINED_FINDINGS) return;
		findings.push({
			kind: 'character',
			file: safeName,
			line: found.line,
			column: found.column + 1,
			...found.data
		});
	});
	const decoder = new TextDecoder('utf-8', { fatal: true });

	try {
		for await (const chunk of createReadStream(path.resolve(root, file))) {
			scanner.write(decoder.decode(chunk, { stream: true }));
		}
		scanner.write(decoder.decode());
		scanner.end();
	} catch (error) {
		if (isMissing(error)) return findings;
		if (findings.length < RETAINED_FINDINGS) {
			if (error instanceof TypeError) findings.push({ kind: 'encoding', file: safeName });
			else findings.push({ kind: 'unreadable', file: safeName });
		}
	}
	return findings;
}

/** The scan's own file set: deduplicated and in path order. */
export function scannableFiles(files: string[]): string[] {
	return [...new Set(files)].sort();
}

/** Every finding across the supplied repo-relative paths, in path order. */
export async function collectFindings(
	files: string[],
	root: string
): Promise<SourceSafetyFinding[]> {
	const findings: SourceSafetyFinding[] = [];
	for (const file of files) {
		findings.push(...(await scanFile(file, root)));
		if (findings.length > REPORT_LIMIT) {
			return [...findings.slice(0, REPORT_LIMIT), { kind: 'omitted' }];
		}
	}
	return findings;
}

export function formatFindings(findings: SourceSafetyFinding[]): string[] {
	return findings.map((finding) => {
		if (finding.kind === 'omitted') return 'More findings omitted; fix these and run again';
		if (finding.kind === 'encoding') return `${finding.file}: invalid UTF-8 in a text file`;
		if (finding.kind === 'unreadable') return `${finding.file}: file could not be read`;
		return finding.line === 0
			? `${finding.file}: ${finding.codepoint} (${finding.category}) in the file name`
			: `${finding.file}:${finding.line}:${finding.column}: ${finding.codepoint} (${finding.category})`;
	});
}

/** Fail before a checker starts, or return how many files were cleared. */
export async function runSourceSafetyPreflight(
	root: string,
	extra: string[] = []
): Promise<number> {
	const files = scannableFiles([...inventory(root), ...extra]);
	const findings = await collectFindings(files, root);
	if (findings.length === 0) return files.length;

	console.error('Source files are unsafe to pass to a checker:');
	for (const line of formatFindings(findings)) console.error(`  ${line}`);
	console.error(
		'\nUse valid UTF-8. Remove each raw control or bidi character, or write it as its \\uXXXX escape inside a string or template literal.'
	);
	process.exit(1);
}

if (import.meta.main) {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const count = await runSourceSafetyPreflight(root);
	console.log(`${count} file(s) hold no raw control or bidi characters`);
}
