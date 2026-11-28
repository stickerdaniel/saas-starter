import { posix } from 'node:path';
import { WORKSPACES, type StarterWorkspace } from '../../.agents/skills/upstream-sync/layout/v3.ts';
import { OWNERS, type OwnerTables } from './owners.ts';
import {
	compareCodeUnits,
	jsonText,
	StaleInput,
	writeText,
	type Manifest,
	type Run
} from './run.ts';

type Section = 'dependencies' | 'devDependencies';

const PLACED_SECTIONS = ['dependencies', 'devDependencies'] as const;
const DEPENDENCY_SECTIONS = [
	...PLACED_SECTIONS,
	'optionalDependencies',
	'peerDependencies'
] as const;

const KNIP_PINS = new Set(['knip']);

const DEVELOPMENT_ONLY = new Set<StarterWorkspace>(['tooling', 'eslint-plugin']);

function manifestPath(workspace: StarterWorkspace): string {
	return `${WORKSPACES[workspace].root}package.json`;
}

function packageName(workspace: StarterWorkspace): string {
	const { name } = WORKSPACES[workspace];
	if (name === null) throw new Error(`${workspace} has no package name`);
	return name;
}

export function sorted(record: Readonly<Record<string, string>>): Record<string, string> {
	return Object.fromEntries(Object.entries(record).sort(([a], [b]) => compareCodeUnits(a, b)));
}

function rootVersions(manifest: Manifest): Map<string, { version: string; section: Section }> {
	const versions = new Map<string, { version: string; section: Section }>();
	for (const section of PLACED_SECTIONS) {
		for (const [name, version] of Object.entries(manifest[section] ?? {})) {
			versions.set(name, { version, section });
		}
	}
	return versions;
}

function sectionProblems(manifest: Manifest): string[] {
	const seen = new Map<string, string>();
	const problems: string[] = [];
	for (const section of DEPENDENCY_SECTIONS) {
		for (const name of Object.keys(manifest[section] ?? {})) {
			if (!(PLACED_SECTIONS as readonly string[]).includes(section)) {
				problems.push(
					`${name} is a dependency in ${section} of the root manifest, which scripts/layout/manifests.ts does not place`
				);
			}
			const earlier = seen.get(name);
			if (earlier)
				problems.push(`${name} stands in ${earlier} and ${section} of the root manifest`);
			seen.set(name, section);
		}
	}
	return problems;
}

function ownerTableProblems(versions: ReadonlyMap<string, unknown>, owners: OwnerTables): string[] {
	const owned = new Set(Object.keys(owners.dependencies));
	return [
		...[...versions.keys()]
			.filter((name) => !owned.has(name))
			.map(
				(name) =>
					`${name} is a dependency of the root manifest without an owner in scripts/layout/owners.ts`
			),
		...[...owned]
			.filter((name) => !versions.has(name))
			.map(
				(name) => `scripts/layout/owners.ts names ${name}, which the root manifest does not declare`
			)
	];
}

function scriptTableProblems(
	scripts: Readonly<Record<string, string>>,
	owners: OwnerTables
): string[] {
	const owned = new Set(Object.keys(owners.scripts));
	const replaced = Object.keys(owners.newScripts.root ?? {}).filter(
		(name) => owners.scripts[name] === 'root'
	);
	return [
		...Object.keys(scripts)
			.filter((name) => !owned.has(name))
			.map(
				(name) =>
					`${name} is a script of the root manifest without an owner in scripts/layout/owners.ts`
			),
		...[...owned]
			.filter((name) => !Object.hasOwn(scripts, name))
			.map(
				(name) =>
					`scripts/layout/owners.ts names the script ${name}, which the root manifest does not declare`
			),
		...replaced
			.filter((name) => owners.replacedRootScripts[name] !== scripts[name])
			.map(
				(name) =>
					`The root script ${name} differs from the flat body its replacement in scripts/layout/owners.ts was written against`
			)
	];
}

type FlatTree = Pick<Run, 'flatPaths' | 'table'>;

function movedPath(run: FlatTree, token: string): string | undefined {
	const clean = token.replace(/^\.\//, '');
	if (!clean || clean.startsWith('-')) return undefined;
	if (run.flatPaths.includes(clean)) {
		const to = run.table.place(clean)?.to;
		if (to === null) throw new StaleInput(`It names ${token}, which the move deletes`);
		return to;
	}
	if (!clean.includes('/')) return undefined;
	const star = clean.indexOf('*');
	const directory =
		star === -1
			? clean.replace(/\/$/, '')
			: clean.slice(0, Math.max(0, clean.lastIndexOf('/', star)));
	if (!directory) return undefined;
	const below = run.flatPaths.filter((tracked) => tracked.startsWith(`${directory}/`));
	if (!below.length) return undefined;
	const kept = below.flatMap((tracked) => {
		const to = run.table.place(tracked)?.to;
		const rest = tracked.slice(directory.length);
		if (to === null) return [];
		return [to !== undefined && to.endsWith(rest) ? to.slice(0, to.length - rest.length) : ''];
	});
	if (!kept.length) throw new StaleInput(`It names ${token}, which the move deletes`);
	const places = new Set(kept);
	if (places.size !== 1 || places.has('')) {
		throw new StaleInput(`It names ${token}, whose files the move sends to more than one place`);
	}
	return kept[0] + clean.slice(directory.length);
}

const QUOTED = /'[^']*'|"[^"]*"/g;
const RUN_NAME_BEFORE = /\bbun run(?:\s+--?[\w-]+(?:[ =][^\s'"]+)?)*\s+$/;

function movePaths(
	run: FlatTree,
	text: string,
	owner: StarterWorkspace,
	warn: (line: string) => void
) {
	const root = WORKSPACES[owner].root;
	return text
		.split(/(\s+)/)
		.map((token) => {
			const [flag, value] = token.match(/^(--[\w-]+=)(.*)$/)?.slice(1) ?? ['', token];
			const moved = movedPath(run, value!);
			if (moved === undefined) return token;
			const relative = posix.relative(root.replace(/\/$/, '') || '.', moved) || '.';
			if (relative.startsWith('..'))
				warn(`${owner} script reads ${relative} outside its workspace`);
			return (
				flag + (value!.startsWith('./') && !relative.startsWith('.') ? `./${relative}` : relative)
			);
		})
		.join('');
}

/**
 * A flat script body, moved to `owner`: each path outside quotes names its moved place relative
 * to the owner, and `bun run <name>` of a script another workspace owns gains `--filter`. Text in
 * quotes stays; a quoted script name or quoted path stops the run, as does a path the move
 * deletes or a directory whose files land in more than one place.
 */
export function moveScript(
	run: FlatTree,
	body: string,
	owner: StarterWorkspace,
	scriptOwner: (name: string) => StarterWorkspace | null | undefined,
	warn: (line: string) => void
): string {
	const pieces: Array<{ text: string; quoted: boolean }> = [];
	let last = 0;
	for (const match of body.matchAll(QUOTED)) {
		pieces.push({ text: body.slice(last, match.index), quoted: false });
		pieces.push({ text: match[0], quoted: true });
		last = match.index + match[0].length;
	}
	pieces.push({ text: body.slice(last), quoted: false });
	return pieces
		.map(({ text, quoted }, index) => {
			if (quoted) {
				if (RUN_NAME_BEFORE.test(pieces[index - 1]?.text ?? '')) {
					throw new StaleInput(`It runs the quoted script name ${text}`);
				}
				for (const token of text.slice(1, -1).split(/\s+/)) {
					if (movedPath(run, token) !== undefined) {
						throw new StaleInput(`It names the quoted path ${token}`);
					}
				}
				return text;
			}
			const filtered = text.replace(/\bbun run (?!-)([\w:.-]+)/g, (whole, name: string) => {
				const target = scriptOwner(name);
				if (target === undefined || target === owner) return whole;
				if (target === null) throw new StaleInput(`It runs ${name}, which the move deletes`);
				if (target === 'root') throw new StaleInput(`It runs the root script ${name}`);
				return `bun run --filter ${packageName(target)} ${name}`;
			});
			return movePaths(run, filtered, owner, warn);
		})
		.join('')
		.replace(/bun run --cwd \. /g, 'bun run ');
}

function scriptsOf(
	run: Run,
	owner: StarterWorkspace,
	warn: (line: string) => void
): Record<string, string> {
	const { scripts: owners, newScripts } = run.inputs.owners;
	const flat = run.flatManifest.scripts ?? {};
	const added = newScripts[owner] ?? {};
	const scriptOwner = (name: string): StarterWorkspace | null | undefined =>
		owner === 'root' && Object.hasOwn(added, name) ? 'root' : owners[name];
	const moved = Object.entries(flat).flatMap(([name, body]) => {
		if (owners[name] !== owner) return [];
		if (owner === 'root' && Object.hasOwn(added, name)) return [];
		try {
			return [[name, moveScript(run, body, owner, scriptOwner, warn)] as const];
		} catch (error) {
			if (!(error instanceof StaleInput)) throw error;
			throw new StaleInput(`The root script ${name} cannot move: ${error.message}`);
		}
	});
	return { ...Object.fromEntries(moved), ...added };
}

/** The workspaces whose packages a workspace imports after the move. */
type EdgeInputs = Pick<Run, 'rewrites' | 'projectEdges'>;

function workspaceEdges(run: EdgeInputs): Map<StarterWorkspace, Set<StarterWorkspace>> {
	const edges = new Map<StarterWorkspace, Set<StarterWorkspace>>();
	const add = (from: StarterWorkspace, to: StarterWorkspace) => {
		if (from === to || from === 'root') return;
		edges.set(from, (edges.get(from) ?? new Set()).add(to));
	};
	for (const rewrite of run.rewrites) {
		if (rewrite.owner !== rewrite.targetOwner && !rewrite.next.startsWith('.')) {
			add(rewrite.owner, rewrite.targetOwner);
		}
	}
	for (const [from, targets] of run.projectEdges) for (const to of targets) add(from, to);
	return edges;
}

function dependenciesOf(
	run: Pick<Run, 'inputs'>,
	owner: StarterWorkspace,
	versions: ReadonlyMap<string, { version: string; section: Section }>,
	edges: ReadonlyMap<StarterWorkspace, ReadonlySet<StarterWorkspace>>
): Record<Section, Record<string, string>> {
	const declared: Record<Section, Record<string, string>> = {
		dependencies: {},
		devDependencies: {}
	};
	for (const [name, holders] of Object.entries(run.inputs.owners.dependencies)) {
		if (!(holders as readonly StarterWorkspace[]).includes(owner)) continue;
		const { version, section } = versions.get(name)!;
		declared[section][name] = version;
	}
	for (const target of edges.get(owner) ?? []) {
		const section = DEVELOPMENT_ONLY.has(target) ? 'devDependencies' : 'dependencies';
		declared[section][packageName(target)] = 'workspace:*';
	}
	return declared;
}

function literalOverrides(
	overrides: Readonly<Record<string, string>>,
	versions: ReadonlyMap<string, { version: string }>
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(overrides).map(([name, value]) => {
			if (!value.startsWith('$')) return [name, value];
			const version = versions.get(value.slice(1))?.version;
			if (version === undefined)
				throw new StaleInput(`The override ${name} names ${value}, which no dependency declares`);
			return [name, version];
		})
	);
}

/** The dependencies and scripts of a flat root manifest that `owners.ts` does not place, and back. */
export function ownerProblems(manifest: Manifest, owners: OwnerTables = OWNERS): string[] {
	return [
		...sectionProblems(manifest),
		...ownerTableProblems(rootVersions(manifest), owners),
		...scriptTableProblems(manifest.scripts ?? {}, owners)
	];
}

type ManifestInputs = Pick<Run, 'flatPaths' | 'table' | 'flatFile'>;

function trackedManifest(run: ManifestInputs, path: string): Manifest | undefined {
	const flat = run.flatPaths.find((tracked) => run.table.place(tracked)?.to === path);
	return flat === undefined ? undefined : JSON.parse(run.flatFile(flat));
}

export function pinProblems(
	run: ManifestInputs & EdgeInputs & Pick<Run, 'inputs' | 'flatManifest'>
): string[] {
	const versions = rootVersions(run.flatManifest);
	const edges = workspaceEdges(run);
	return (Object.keys(WORKSPACES) as StarterWorkspace[]).flatMap((workspace) => {
		if (workspace === 'root') return [];
		const path = manifestPath(workspace);
		const existing = trackedManifest(run, path);
		if (!existing) return [];
		const declared = dependenciesOf(run, workspace, versions, edges);
		return PLACED_SECTIONS.flatMap((section) =>
			Object.entries(declared[section]).flatMap(([name, version]) => {
				const pinned = existing.dependencies?.[name] ?? existing.devDependencies?.[name];
				if (pinned === undefined || pinned === version || KNIP_PINS.has(name)) return [];
				return [`${path} pins ${name} at ${pinned}, and the root manifest at ${version}`];
			})
		);
	});
}

export function verifyOwners(run: Run): void {
	const problems = [...ownerProblems(run.flatManifest, run.inputs.owners), ...pinProblems(run)];
	if (problems.length) throw new StaleInput(problems.join('\n'));
}

/**
 * Derives every workspace manifest from the flat root manifest and `owners.ts`. A workspace that
 * has a manifest already keeps its fields and gains what the map gives it.
 */
export function writeManifests(run: Run, warn: (line: string) => void = console.warn): void {
	const versions = rootVersions(run.flatManifest);
	const edges = workspaceEdges(run);
	const peers: Partial<Record<StarterWorkspace, readonly string[]>> = run.inputs.owners.peers;
	for (const workspace of Object.keys(WORKSPACES) as StarterWorkspace[]) {
		const path = manifestPath(workspace);
		const declared = dependenciesOf(run, workspace, versions, edges);
		const scripts = scriptsOf(run, workspace, warn);
		if (workspace === 'root') {
			const { imports: _imports, ...flat } = run.flatManifest;
			run.manifests.set(workspace, {
				...flat,
				templateSetupVersion: 3,
				workspaces: ['apps/*', 'packages/*'],
				scripts,
				dependencies: sorted(declared.dependencies),
				devDependencies: sorted(declared.devDependencies),
				overrides: literalOverrides(run.flatManifest.overrides ?? {}, versions)
			});
			continue;
		}
		const existing = trackedManifest(run, path);
		const peerNames = peers[workspace] ?? [];
		const merge = (section: Section, current: Readonly<Record<string, string>> = {}) => {
			const result = { ...current };
			for (const [name, version] of Object.entries(declared[section])) {
				if (!Object.hasOwn(result, name)) result[name] = version;
			}
			for (const name of peerNames) {
				if (section === 'devDependencies' && !Object.hasOwn(result, name)) {
					result[name] = versions.get(name)!.version;
				}
			}
			const dependencies = section === 'dependencies' ? result : undefined;
			if (dependencies) for (const name of peerNames) delete dependencies[name];
			return sorted(result);
		};
		const manifest: Manifest = existing
			? { ...existing }
			: {
					name: packageName(workspace),
					version: '0.0.0',
					private: true,
					license: 'MIT',
					type: 'module'
				};
		const mergedScripts = { ...existing?.scripts, ...scripts };
		if (Object.keys(mergedScripts).length) manifest.scripts = mergedScripts;
		const dependencies = merge('dependencies', existing?.dependencies);
		const devDependencies = merge('devDependencies', existing?.devDependencies);
		if (Object.keys(dependencies).length) manifest.dependencies = dependencies;
		if (Object.keys(devDependencies).length) manifest.devDependencies = devDependencies;
		if (peerNames.length) {
			manifest.peerDependencies = sorted({
				...existing?.peerDependencies,
				...Object.fromEntries(peerNames.map((name) => [name, `^${versions.get(name)!.version}`]))
			});
		}
		run.manifests.set(workspace, manifest);
	}
}

const FIELD_ORDER = [
	'name',
	'version',
	'templateSetupVersion',
	'templateProfiles',
	'description',
	'license',
	'type',
	'private',
	'repository',
	'homepage',
	'bugs',
	'keywords',
	'publishConfig',
	'bin',
	'files',
	'engines',
	'workspaces',
	'imports',
	'exports',
	'scripts',
	'packageManager',
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'patchedDependencies',
	'overrides'
];

/** Writes the manifests the steps built. A new manifest takes one field order; a flat one keeps its own. */
export function saveManifests(run: Run): void {
	for (const [workspace, manifest] of run.manifests) {
		const path = manifestPath(workspace);
		const flat = run.flatPaths.includes(path);
		const known = FIELD_ORDER.filter((field) => Object.hasOwn(manifest, field));
		const rest = Object.keys(manifest).filter((field) => !FIELD_ORDER.includes(field));
		const order = flat ? Object.keys(manifest) : [...known, ...rest];
		writeText(
			run,
			path,
			jsonText(Object.fromEntries(order.map((field) => [field, manifest[field]])))
		);
	}
}
