import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogueEntry } from '../../src/lib/licenses/catalogue';
import type { PackageOverride, ThirdPartyLicensesConfig } from './config';
import { normalizeNoticeText, renderGeneratedNotice } from './generated';

/** A module id or file that ships in the public output, with its component label. */
export interface ShippedInput {
	id: string;
	component: string;
}

export interface ResolveOptions {
	/** Project root; anchors noticeFiles and extra package lookup. */
	root: string;
	config: ThirdPartyLicensesConfig;
	shipped: ShippedInput[];
	/** Name of the configuration file, used in fix instructions. */
	configFileName?: string;
}

export interface ResolveResult {
	entries: CatalogueEntry[];
	/** One block per problem; a non-empty list must fail the build. */
	errors: string[];
	warnings: string[];
}

interface Notice {
	label: string;
	text: string;
	rank: number;
}

// Rank orders notices inside an entry: primary vendor text first, then nested
// and supplemental vendor files, then reviewed override evidence.
const RANK_ROOT_LICENSE = 0;
const RANK_NESTED_LICENSE = 1;
const RANK_SUPPLEMENTAL = 2;
const RANK_OVERRIDE_FILE = 3;
const RANK_GENERATED = 4;

const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[-_.].*)?$/i;
const NOTICE_FILE = /^notice(?:[-_.].*)?$/i;
const NOT_A_NOTICE = /\.(?:[cm]?[jt]sx?|map|json|wasm|node)$/i;

/**
 * Turn a bundler module id into an absolute, forward-slash file path, or null
 * for virtual modules that are not files (`\0vite/preload-helper.js`). A NUL
 * prefix in front of an absolute path is a proxy for that real file.
 */
export function moduleIdToPath(id: string): string | null {
	let value = id.startsWith('\0') ? id.slice(1) : id;
	const query = value.indexOf('?');
	if (query !== -1) value = value.slice(0, query);
	if (value.startsWith('file:')) {
		try {
			value = fileURLToPath(value);
		} catch {
			return null;
		}
	}
	value = value.replaceAll('\\', '/');
	if (value.startsWith('/@fs/')) value = value.slice('/@fs'.length);
	if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
	if (!value.startsWith('/') && !/^[A-Za-z]:\//.test(value)) return null;
	return value;
}

/**
 * The package directory owning a forward-slash file path: the entry right
 * below its innermost `node_modules`. Null for first-party files.
 */
export function packageRootOf(file: string): string | null {
	const marker = '/node_modules/';
	const index = file.lastIndexOf(marker);
	if (index === -1) return null;
	const rest = file.slice(index + marker.length).split('/');
	const segments = rest[0]?.startsWith('@') ? 2 : 1;
	if (rest.length <= segments) return null;
	return file.slice(0, index + marker.length) + rest.slice(0, segments).join('/');
}

function toPosix(value: string): string {
	return value.replaceAll('\\', '/');
}

function readJson(file: string): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
		return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function isFile(file: string): boolean {
	try {
		return statSync(file).isFile();
	} catch {
		return false;
	}
}

function readNotice(file: string): string | null {
	const text = normalizeNoticeText(readFileSync(file, 'utf8'));
	return text ? text : null;
}

interface NoticeFile {
	name: string;
	/** True for license texts, false for supplemental NOTICE files. */
	license: boolean;
}

function noticeFilesIn(directory: string): NoticeFile[] {
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch {
		return [];
	}
	return names
		.filter((name) => !NOT_A_NOTICE.test(name) && isFile(path.join(directory, name)))
		.flatMap((name): NoticeFile[] => {
			if (LICENSE_FILE.test(name)) return [{ name, license: true }];
			if (NOTICE_FILE.test(name)) return [{ name, license: false }];
			return [];
		});
}

/** Repository URL from package metadata, normalized to a browsable http(s) URL. */
function repositoryUrl(manifest: Record<string, unknown>): string | null {
	const repository = manifest.repository;
	let raw =
		typeof repository === 'string'
			? repository
			: repository && typeof repository === 'object' && 'url' in repository
				? String((repository as { url: unknown }).url)
				: null;
	if (!raw) return null;
	if (/^(?:github:)?[\w.-]+\/[\w.-]+$/.test(raw))
		raw = `https://github.com/${raw.replace(/^github:/, '')}`;
	raw = raw
		.replace(/^git\+/, '')
		.replace(/^git:\/\//, 'https://')
		.replace(/^ssh:\/\/git@/, 'https://')
		.replace(/^git@([^:]+):/, 'https://$1/')
		.replace(/\.git$/, '');
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}

function findInstalledPackage(root: string, name: string): string | null {
	let directory = root;
	while (true) {
		const candidate = path.join(directory, 'node_modules', ...name.split('/'));
		if (isFile(path.join(candidate, 'package.json'))) return candidate;
		const parent = path.dirname(directory);
		if (parent === directory) return null;
		directory = parent;
	}
}

interface PhysicalPackage {
	root: string;
	name: string;
	version: string;
	declaration: string | null;
	sourceUrl: string | null;
	components: Set<string>;
	shippedFiles: Set<string>;
}

function overrideFileName(name: string, version: string): string {
	return `third-party-notices/${name.replace(/^@/, '').replaceAll('/', '-')}-${version}.txt`;
}

function incompleteBlock(
	key: string,
	components: string[],
	missingDeclaration: boolean,
	missingText: boolean,
	declaration: string | null,
	configFileName: string
): string {
	const [name, version] = [key.slice(0, key.lastIndexOf('@')), key.slice(key.lastIndexOf('@') + 1)];
	const lines = [`${key} [${components.join(', ')}]`];
	if (missingDeclaration) {
		lines.push('  Missing: license declaration (package.json has no "license" string).');
	}
	if (missingText) {
		lines.push(
			`  Missing: license text (${declaration ? `package declares "${declaration}" but` : 'package'} ships no root LICENSE/LICENCE/COPYING file).`
		);
	}
	const fields = [
		`"name": "${name}"`,
		`"version": "${version}"`,
		`"sourceUrl": "<URL of the ${missingText ? 'license text' : 'license evidence'} at that release>"`
	];
	if (missingDeclaration) fields.push('"license": "<SPDX expression from that source>"');
	if (missingText) {
		const file = overrideFileName(name, version);
		lines.push(`  Fix: copy the license text of this exact release into ${file}`);
		fields.push(`"noticeFiles": ["${file}"]`);
	} else {
		lines.push('  Fix: confirm the license of this exact release from an upstream source');
	}
	lines.push(
		`  and add to packageOverrides in ${configFileName}:`,
		`    { ${fields.join(', ')} }`,
		'  Do not invent copyright lines or use the package author as the holder.'
	);
	return lines.join('\n');
}

function sortNotices(notices: Notice[]): Array<{ label: string; text: string }> {
	const unique = new Map<string, Notice>();
	for (const notice of notices) unique.set(`${notice.label}\0${notice.text}`, notice);
	return [...unique.values()]
		.sort((a, b) => a.rank - b.rank || compare(a.label, b.label) || compare(a.text, b.text))
		.map(({ label, text }) => ({ label, text }));
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function overrideNotices(
	override: {
		sourceUrl: string;
		noticeFiles?: string[];
		generatedNotices?: PackageOverride['generatedNotices'];
	},
	root: string,
	owner: string,
	errors: string[]
): Notice[] {
	const notices: Notice[] = [];
	const files = override.noticeFiles ?? [];
	for (const file of files) {
		const absolute = path.resolve(root, file);
		const text = isFile(absolute) ? readNotice(absolute) : null;
		if (!text) {
			errors.push(`${owner}\n  noticeFiles entry "${file}" is missing or empty.`);
			continue;
		}
		notices.push({ label: path.basename(file), text, rank: RANK_OVERRIDE_FILE });
	}
	for (const generated of override.generatedNotices ?? []) {
		notices.push({
			label: `SPDX ${generated.licenseId} text`,
			text: renderGeneratedNotice(generated),
			rank: RANK_GENERATED
		});
	}
	return notices;
}

/**
 * Resolve every shipped input to its package, check notice completeness, and
 * return catalogue entries plus aggregated errors. Never touches the network.
 */
export function resolveThirdPartyNotices(options: ResolveOptions): ResolveResult {
	const { root, config } = options;
	const configFileName = options.configFileName ?? 'third-party-licenses.config.json';
	const errors: string[] = [];
	const warnings: string[] = [];
	const physical = new Map<string, PhysicalPackage>();
	const unattributable = new Set<string>();

	function addPhysical(directory: string, component: string, shippedFile?: string) {
		let realRoot: string;
		try {
			realRoot = realpathSync(directory);
		} catch {
			unattributable.add(directory);
			return;
		}
		let entry = physical.get(realRoot);
		if (!entry) {
			const manifest = readJson(path.join(realRoot, 'package.json'));
			const name = typeof manifest?.name === 'string' ? manifest.name : null;
			const version = typeof manifest?.version === 'string' ? manifest.version : null;
			if (!manifest || !name || !version) {
				unattributable.add(directory);
				return;
			}
			entry = {
				root: realRoot,
				name,
				version,
				declaration:
					typeof manifest.license === 'string' && manifest.license.trim()
						? manifest.license.trim()
						: null,
				sourceUrl: repositoryUrl(manifest),
				components: new Set(),
				shippedFiles: new Set()
			};
			physical.set(realRoot, entry);
		}
		entry.components.add(component);
		if (shippedFile) {
			try {
				entry.shippedFiles.add(realpathSync(shippedFile));
			} catch {
				// A shipped id without a file on disk still marks its package; nested
				// notice discovery simply has no directory to start from.
			}
		}
	}

	for (const input of options.shipped) {
		const file = moduleIdToPath(input.id);
		if (!file) continue;
		const packageRoot = packageRootOf(file);
		if (!packageRoot) continue;
		if (path.basename(packageRoot).startsWith('.')) {
			unattributable.add(toPosix(file));
			continue;
		}
		addPhysical(packageRoot, input.component, file);
	}

	for (const extra of config.extraPackages) {
		const directory = findInstalledPackage(root, extra.name);
		if (!directory) {
			errors.push(
				`${extra.name} [${extra.components.join(', ')}]\n  Listed in extraPackages but not installed. Install it or remove the entry from ${configFileName}.`
			);
			continue;
		}
		for (const component of extra.components) addPhysical(directory, component);
	}

	for (const item of [...unattributable].sort()) {
		errors.push(
			`${item}\n  Shipped from node_modules but has no readable package.json with a name and version.`
		);
	}

	const groups = new Map<string, PhysicalPackage[]>();
	for (const entry of physical.values()) {
		const key = `${entry.name}@${entry.version}`;
		groups.set(key, [...(groups.get(key) ?? []), entry]);
	}

	const overrides = new Map(config.packageOverrides.map((o) => [`${o.name}@${o.version}`, o]));
	const usedOverrides = new Set<string>();
	const incomplete: string[] = [];
	const entries: CatalogueEntry[] = [];

	for (const [key, copies] of [...groups].sort(([a], [b]) => compare(a, b))) {
		const override = overrides.get(key);
		if (override) usedOverrides.add(key);
		const components = [...new Set(copies.flatMap((copy) => [...copy.components]))].sort(compare);
		const declarations = [...new Set(copies.map((copy) => copy.declaration).filter(Boolean))];
		if (!override?.license && declarations.length > 1) {
			errors.push(
				`${key} [${components.join(', ')}]\n  Installed copies declare conflicting licenses: ${declarations.map((d) => `"${d}"`).join(', ')}. Add an override with the evidenced "license" to ${configFileName}.`
			);
			continue;
		}
		const declaration = override?.license ?? declarations[0] ?? null;

		const notices: Notice[] = [];
		let hasRootLicense = false;
		for (const copy of copies) {
			for (const file of noticeFilesIn(copy.root)) {
				const text = readNotice(path.join(copy.root, file.name));
				if (!text) continue;
				if (file.license) hasRootLicense = true;
				notices.push({
					label: file.name,
					text,
					rank: file.license ? RANK_ROOT_LICENSE : RANK_SUPPLEMENTAL
				});
			}
			const directories = new Set<string>();
			for (const shippedFile of copy.shippedFiles) {
				let directory = path.dirname(shippedFile);
				while (directory.startsWith(copy.root + path.sep) && directory !== copy.root) {
					directories.add(directory);
					directory = path.dirname(directory);
				}
			}
			for (const directory of directories) {
				for (const file of noticeFilesIn(directory)) {
					const absolute = path.join(directory, file.name);
					const text = readNotice(absolute);
					if (!text) continue;
					notices.push({
						label: toPosix(path.relative(copy.root, absolute)),
						text,
						rank: file.license ? RANK_NESTED_LICENSE : RANK_SUPPLEMENTAL
					});
				}
			}
		}

		const evidenceErrors: string[] = [];
		const evidence = override ? overrideNotices(override, root, key, evidenceErrors) : [];
		errors.push(...evidenceErrors);
		notices.push(...evidence);
		const hasPrimaryText =
			hasRootLicense || evidence.some((notice) => notice.rank >= RANK_OVERRIDE_FILE);

		if (!declaration || !hasPrimaryText) {
			if (evidenceErrors.length) continue;
			incomplete.push(
				incompleteBlock(key, components, !declaration, !hasPrimaryText, declaration, configFileName)
			);
			continue;
		}

		const [first] = copies;
		entries.push({
			id: `npm:${key}`,
			kind: 'package',
			name: first!.name,
			version: first!.version,
			license: declaration,
			components,
			sourceUrl: override?.sourceUrl ?? copies.map((copy) => copy.sourceUrl).find(Boolean) ?? null,
			notices: sortNotices(notices)
		});
	}

	for (const custom of config.customNotices) {
		const owner = `custom notice "${custom.id}"`;
		const evidenceErrors: string[] = [];
		const notices = overrideNotices(custom, root, owner, evidenceErrors);
		errors.push(...evidenceErrors);
		if (evidenceErrors.length) continue;
		entries.push({
			id: `custom:${custom.id}`,
			kind: 'custom',
			name: custom.name,
			version: custom.revision ?? null,
			license: custom.license,
			components: [...new Set(custom.components)].sort(compare),
			sourceUrl: custom.sourceUrl,
			notices: sortNotices(notices)
		});
	}

	if (incomplete.length) {
		errors.unshift(
			`Third-party notices incomplete for ${incomplete.length} ${incomplete.length === 1 ? 'package' : 'packages'}. Fix each, then rerun \`bun run build\`.`,
			...incomplete
		);
	}

	for (const key of [...overrides.keys()].filter((key) => !usedOverrides.has(key)).sort(compare)) {
		warnings.push(
			`Override for ${key} in ${configFileName} matched no shipped package. Remove it if that package or version no longer ships.`
		);
	}

	return { entries, errors, warnings };
}
