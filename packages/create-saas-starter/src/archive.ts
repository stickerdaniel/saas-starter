import { createHash } from 'node:crypto';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Parser, type ReadEntry } from 'tar';
import { isReservedWindowsDeviceName } from './options.js';
import { MAX_ARCHIVE_BYTES } from './template.js';

export const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_PATH_DEPTH = 64;
const MAX_META_ENTRY_BYTES = 1024 * 1024;
export const SCAFFOLD_MARKER = '.saas-starter-scaffold.json';

interface ArchiveFile {
	path: string;
	type: 'file' | 'directory';
	data?: Buffer;
	mode: number;
}

export interface ValidatedArchive {
	files: ArchiveFile[];
	sha256: string;
}

export interface ArchiveValidationMetrics {
	treeParentLookups: number;
	aliasIndexComparisons: number;
	aliasDescendantVisits: number;
	aliasEntriesMaterialized: number;
	aliasBytesMaterialized: number;
}

interface ParsedEntry {
	path: string;
	type: 'file' | 'directory' | 'symlink';
	data?: Buffer;
	linkpath?: string;
	mode: number;
}

function fail(message: string): never {
	throw new Error(`Unsafe template archive: ${message}`);
}

function portableKey(value: string): string {
	return value
		.split('/')
		.map((segment) => segment.normalize('NFC').toLowerCase())
		.join('/');
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0)!;
		return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
	});
}

function validatePortablePath(value: string): string[] {
	if (value === '' || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) {
		fail(`absolute or empty path ${JSON.stringify(value)}`);
	}
	if (value.includes('\\')) fail(`backslash path ${JSON.stringify(value)}`);
	if (hasControlCharacter(value)) fail('control character in a path');
	const segments = value.split('/');
	if (segments.length > MAX_PATH_DEPTH) fail(`path depth exceeds ${MAX_PATH_DEPTH}`);
	for (const segment of segments) {
		if (segment === '' || segment === '.' || segment === '..')
			fail('empty or traversing path segment');
		if (/[<>"|?*:]/.test(segment)) fail(`Win32-reserved character in ${JSON.stringify(segment)}`);
		if (/[. ]$/.test(segment)) fail(`trailing dot or space in ${JSON.stringify(segment)}`);
		if (isReservedWindowsDeviceName(segment)) {
			fail(`reserved Windows device name ${JSON.stringify(segment)}`);
		}
		if (Buffer.byteLength(segment, 'utf8') > 255 || segment.length > 255) {
			fail(`path segment exceeds the portable length limit: ${JSON.stringify(segment)}`);
		}
	}
	return segments;
}

function isRejectedTemplatePath(value: string): boolean {
	const lower = value.toLowerCase();
	const segments = lower.split('/');
	const basename = segments.at(-1)!;
	return (
		segments.includes('.git') ||
		lower === SCAFFOLD_MARKER ||
		lower.startsWith(`${SCAFFOLD_MARKER}.`) ||
		(basename.startsWith('.env') &&
			!['.env.schema', '.env-convex.schema', '.env.convex.example'].includes(basename)) ||
		(lower.startsWith('.claude/') && /^settings(?:\.local)?\.json$/.test(basename)) ||
		basename === 'handoff.md' ||
		basename.startsWith('.handoff')
	);
}

async function parseTar(raw: Buffer): Promise<ParsedEntry[]> {
	return await new Promise((resolve, reject) => {
		const entries: ParsedEntry[] = [];
		let settled = false;
		const rejectOnce = (error: unknown) => {
			if (settled) return;
			settled = true;
			reject(error instanceof Error ? error : new Error(String(error)));
		};
		const parser = new Parser({ strict: true, maxMetaEntrySize: MAX_META_ENTRY_BYTES });
		parser.on('warn', (code, message) => rejectOnce(new Error(`tar warning ${code}: ${message}`)));
		parser.on('ignoredEntry', () => rejectOnce(new Error('tar parser ignored an archive entry')));
		parser.on('error', rejectOnce);
		parser.on('entry', (entry: ReadEntry) => {
			if (settled) {
				entry.resume();
				return;
			}
			if (++entries.length > MAX_ARCHIVE_ENTRIES) {
				entry.resume();
				rejectOnce(new Error(`archive contains more than ${MAX_ARCHIVE_ENTRIES} entries`));
				return;
			}
			const chunks: Buffer[] = [];
			let size = 0;
			entry.on('data', (chunk: Buffer) => {
				size += chunk.length;
				if (size > MAX_DECOMPRESSED_BYTES) {
					rejectOnce(new Error('archive entry exceeds the decompressed size limit'));
					return;
				}
				chunks.push(Buffer.from(chunk));
			});
			entry.on('error', rejectOnce);
			entry.on('end', () => {
				if (settled) return;
				let type: ParsedEntry['type'];
				if (entry.type === 'File' || entry.type === 'OldFile' || entry.type === 'ContiguousFile') {
					type = 'file';
				} else if (entry.type === 'Directory' || entry.type === 'GNUDumpDir') {
					type = 'directory';
				} else if (entry.type === 'SymbolicLink') {
					type = 'symlink';
				} else {
					rejectOnce(new Error(`unsupported tar entry type ${entry.type}`));
					return;
				}
				entries[entries.length - 1] = {
					path: entry.path.replace(/\/$/, ''),
					type,
					data: type === 'file' ? Buffer.concat(chunks, size) : undefined,
					linkpath: entry.linkpath,
					mode: entry.mode ?? (type === 'directory' ? 0o755 : 0o644)
				};
			});
			entry.resume();
		});
		parser.on('end', () => {
			if (settled) return;
			settled = true;
			resolve(entries);
		});
		parser.end(raw);
	});
}

function validateTree(
	entries: ParsedEntry[],
	metrics?: ArchiveValidationMetrics
): Map<string, ParsedEntry> {
	const tree = new Map<string, ParsedEntry>();
	for (const entry of entries) {
		validatePortablePath(entry.path);
		if (isRejectedTemplatePath(entry.path)) fail(`forbidden template path ${entry.path}`);
		const key = portableKey(entry.path);
		if (tree.has(key)) fail(`duplicate or portable path collision at ${entry.path}`);
		tree.set(key, entry);
	}
	for (const [key, entry] of tree) {
		const segments = key.split('/');
		let parentKey = '';
		for (let index = 0; index < segments.length - 1; index++) {
			parentKey = parentKey === '' ? segments[index]! : `${parentKey}/${segments[index]}`;
			if (metrics) metrics.treeParentLookups += 1;
			const parent = tree.get(parentKey);
			if (parent && parent.type !== 'directory') fail(`file/parent conflict at ${entry.path}`);
		}
	}
	return tree;
}

function lowerBoundEntries(
	entries: Array<[string, ParsedEntry]>,
	key: string,
	metrics?: ArchiveValidationMetrics
): number {
	let low = 0;
	let high = entries.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (metrics) metrics.aliasIndexComparisons += 1;
		if (entries[middle]![0] < key) low = middle + 1;
		else high = middle;
	}
	return low;
}

function materializeAliases(
	entries: ParsedEntry[],
	metrics?: ArchiveValidationMetrics
): ParsedEntry[] {
	const tree = validateTree(entries, metrics);
	const indexedEntries = [...tree.entries()].sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	);
	const result = entries.filter((entry) => entry.type !== 'symlink');
	let bytes = result.reduce((total, entry) => total + (entry.data?.length ?? 0), 0);
	const add = (sourceItem: ParsedEntry, destination: string) => {
		const dataBytes = sourceItem.data?.length ?? 0;
		if (result.length === MAX_ARCHIVE_ENTRIES) {
			fail('alias materialization exceeds the entry limit');
		}
		if (bytes + dataBytes > MAX_DECOMPRESSED_BYTES) {
			fail('alias materialization exceeds the size limit');
		}
		const key = portableKey(destination);
		if (tree.has(key) && tree.get(key)?.type !== 'symlink') {
			fail(`alias collision at ${destination}`);
		}
		const entry = {
			...sourceItem,
			path: destination,
			data: sourceItem.data ? Buffer.from(sourceItem.data) : undefined
		};
		tree.set(key, entry);
		result.push(entry);
		bytes += dataBytes;
		if (metrics) {
			metrics.aliasEntriesMaterialized += 1;
			metrics.aliasBytesMaterialized += dataBytes;
		}
	};

	for (const alias of entries.filter((entry) => entry.type === 'symlink')) {
		let source: string;
		if (alias.path === 'CLAUDE.md' && alias.linkpath === 'AGENTS.md') {
			source = 'AGENTS.md';
		} else {
			const match = /^\.claude\/skills\/([^/]+)$/.exec(alias.path);
			if (!match || alias.linkpath !== `../../.agents/skills/${match[1]}`) {
				fail(`unknown symbolic link ${alias.path}`);
			}
			source = `.agents/skills/${match[1]}`;
		}
		const sourceKey = portableKey(source);
		const sourceEntry = tree.get(sourceKey);
		if (!sourceEntry || sourceEntry.type === 'symlink') {
			fail(`symbolic link target is missing: ${alias.path}`);
		}
		const descendants = [sourceEntry];
		const descendantPrefix = `${sourceKey}/`;
		for (
			let index = lowerBoundEntries(indexedEntries, descendantPrefix, metrics);
			index < indexedEntries.length && indexedEntries[index]![0].startsWith(descendantPrefix);
			index++
		) {
			if (metrics) metrics.aliasDescendantVisits += 1;
			descendants.push(indexedEntries[index]![1]);
		}
		if (descendants.some((entry) => entry.type === 'symlink')) {
			fail(`symbolic link target contains another link: ${alias.path}`);
		}
		for (const sourceItem of descendants) {
			const suffix = sourceItem.path.slice(source.length);
			const destination = `${alias.path}${suffix}`;
			validatePortablePath(destination);
			add(sourceItem, destination);
		}
	}

	validateTree(result, metrics);
	return result;
}

function stripArchiveRoot(entries: ParsedEntry[]): ParsedEntry[] {
	if (entries.length === 0) fail('archive is empty');
	let root: string | undefined;
	const stripped: ParsedEntry[] = [];
	for (const entry of entries) {
		const segments = validatePortablePath(entry.path);
		if (root === undefined) root = segments[0];
		if (portableKey(segments[0]!) !== portableKey(root)) fail('archive contains multiple roots');
		if (segments.length === 1) {
			if (entry.type !== 'directory') fail('archive root is not a directory');
			continue;
		}
		const relativePath = segments.slice(1).join('/');
		stripped.push({ ...entry, path: relativePath });
	}
	if (stripped.length === 0) fail('archive root has no contents');
	return stripped;
}

function validateTemplateContract(entries: ParsedEntry[]): void {
	const tree = new Map(entries.map((entry) => [portableKey(entry.path), entry]));
	const requiredFiles = [
		'package.json',
		'bun.lock',
		'scripts/template-setup.ts',
		'wrangler.toml',
		'README.md',
		'src/lib/config/site.ts',
		'src/lib/config/legal.ts',
		'src/lib/content/legal-metadata.ts'
	];
	for (const requiredFile of requiredFiles) {
		const entry = tree.get(portableKey(requiredFile));
		if (entry?.type !== 'file' || entry.path !== requiredFile) {
			fail(`public setup requires regular file ${requiredFile}`);
		}
	}
	const manifest = tree.get('package.json')!;
	let value: unknown;
	try {
		value = JSON.parse(manifest.data!.toString('utf8'));
	} catch {
		fail('package.json is invalid JSON');
	}
	const packageJson = value as {
		templateSetupVersion?: unknown;
		scripts?: Record<string, unknown>;
	};
	if (
		packageJson.templateSetupVersion !== 1 ||
		packageJson.scripts?.setup !== 'bun scripts/template-setup.ts'
	) {
		fail('templateSetupVersion:1 and the public setup script are required');
	}
}

export async function validateTemplateArchive(
	compressed: Buffer,
	metrics?: ArchiveValidationMetrics
): Promise<ValidatedArchive> {
	if (compressed.length === 0 || compressed.length > MAX_ARCHIVE_BYTES) {
		fail(`compressed archive must be at most ${MAX_ARCHIVE_BYTES} bytes`);
	}
	let raw: Buffer;
	try {
		raw = gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES + 1 });
	} catch (error) {
		throw new Error(
			`Unsafe template archive: gzip decompression failed: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
	if (raw.length > MAX_DECOMPRESSED_BYTES) fail('decompressed archive exceeds the size limit');
	const parsed = await parseTar(raw);
	const rooted = stripArchiveRoot(parsed);
	const materialized = materializeAliases(rooted, metrics);
	validateTemplateContract(materialized);
	return {
		files: materialized.map((entry) => ({
			path: entry.path,
			type: entry.type as 'file' | 'directory',
			data: entry.data,
			mode: entry.type === 'directory' ? 0o755 : 0o644 | (entry.mode & 0o111)
		})),
		sha256: createHash('sha256').update(compressed).digest('hex')
	};
}

export function archivePathForTarget(target: string, relativePath: string): string {
	const segments = validatePortablePath(relativePath);
	const destination = path.join(target, ...segments);
	const fromTarget = path.relative(target, destination);
	if (
		fromTarget === '..' ||
		fromTarget.startsWith(`..${path.sep}`) ||
		path.isAbsolute(fromTarget)
	) {
		fail(`target escape at ${relativePath}`);
	}
	return destination;
}
