import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { WORKSPACES, type StarterWorkspace } from '../../.agents/skills/upstream-sync/layout/v3.ts';
import { DEPENDENCY_OWNERS, NEW_SCRIPTS, PEER_DEPENDENCIES, SCRIPT_OWNERS } from './owners.ts';
import { jsonText, readText, StaleInput, writeText, type Manifest, type Run } from './run.ts';

type Section = 'dependencies' | 'devDependencies';

const DEVELOPMENT_ONLY = new Set<StarterWorkspace>(['tooling', 'eslint-plugin']);

function manifestPath(workspace: StarterWorkspace): string {
	return `${WORKSPACES[workspace].root}package.json`;
}

function packageName(workspace: StarterWorkspace): string {
	const { name } = WORKSPACES[workspace];
	if (name === null) throw new Error(`${workspace} has no package name`);
	return name;
}

function sorted(record: Readonly<Record<string, string>>): Record<string, string> {
	return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/** The root manifest's version of every dependency, with the section that declares it. */
function rootVersions(manifest: Manifest): Map<string, { version: string; section: Section }> {
	const versions = new Map<string, { version: string; section: Section }>();
	for (const section of ['dependencies', 'devDependencies'] as const) {
		for (const [name, version] of Object.entries(manifest[section] ?? {})) {
			versions.set(name, { version, section });
		}
	}
	return versions;
}

function ownerTableProblems(versions: ReadonlyMap<string, unknown>): string[] {
	const owned = new Set(Object.keys(DEPENDENCY_OWNERS));
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

function scriptTableProblems(scripts: Readonly<Record<string, string>>): string[] {
	const owned = new Set(Object.keys(SCRIPT_OWNERS));
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
			)
	];
}

/** The moved place of a flat path, file, directory or glob, or `undefined` when it names none. */
type FlatTree = Pick<Run, 'flatPaths' | 'table'>;

function movedPath(run: FlatTree, token: string): string | undefined {
	const clean = token.replace(/^\.\//, '');
	if (!clean || clean.startsWith('-')) return undefined;
	if (run.flatPaths.includes(clean)) return run.table.place(clean)?.to ?? undefined;
	if (!clean.includes('/')) return undefined;
	const star = clean.indexOf('*');
	const directory =
		star === -1
			? clean.replace(/\/$/, '')
			: clean.slice(0, Math.max(0, clean.lastIndexOf('/', star)));
	if (!directory) return undefined;
	const below = run.flatPaths.find((tracked) => tracked.startsWith(`${directory}/`));
	const to = below && run.table.place(below)?.to;
	if (!below || !to) return undefined;
	const rest = below.slice(directory.length);
	if (!to.endsWith(rest)) {
		throw new StaleInput(`The script path ${token} names a directory that the table splits`);
	}
	return to.slice(0, to.length - rest.length) + clean.slice(directory.length);
}

/**
 * A flat script body, moved to `owner`: each path names its moved place relative to the
 * owner, and `bun run <name>` of a script another workspace owns gains `--filter`.
 */
export function moveScript(
	run: FlatTree,
	body: string,
	owner: StarterWorkspace,
	scriptOwner: (name: string) => StarterWorkspace | null | undefined,
	warn: (line: string) => void
): string {
	const root = WORKSPACES[owner].root;
	const filtered = body.replace(/\bbun run (?!-)([\w:.-]+)/g, (whole, name: string) => {
		const target = scriptOwner(name);
		if (target === undefined || target === owner) return whole;
		if (target === null) throw new StaleInput(`A script runs ${name}, which the move deletes`);
		if (target === 'root') throw new StaleInput(`The ${owner} script runs the root script ${name}`);
		return `bun run --filter ${packageName(target)} ${name}`;
	});
	return filtered
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
		.join('')
		.replace(/bun run --cwd \. /g, 'bun run ');
}

function scriptsOf(
	run: Run,
	owner: StarterWorkspace,
	warn: (line: string) => void
): Record<string, string> {
	const flat = run.flatManifest.scripts ?? {};
	const added: Readonly<Record<string, string>> =
		(NEW_SCRIPTS as Partial<Record<StarterWorkspace, Readonly<Record<string, string>>>>)[owner] ??
		{};
	const scriptOwner = (name: string): StarterWorkspace | null | undefined =>
		owner === 'root' && Object.hasOwn(added, name)
			? 'root'
			: (SCRIPT_OWNERS as Record<string, StarterWorkspace | null>)[name];
	const moved = Object.entries(flat).flatMap(([name, body]) => {
		if ((SCRIPT_OWNERS as Record<string, StarterWorkspace | null>)[name] !== owner) return [];
		if (owner === 'root' && Object.hasOwn(added, name)) return [];
		return [[name, moveScript(run, body, owner, scriptOwner, warn)] as const];
	});
	return { ...Object.fromEntries(moved), ...added };
}

/** The workspaces whose packages a workspace imports after the move. */
function workspaceEdges(run: Run): Map<StarterWorkspace, Set<StarterWorkspace>> {
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
	run: Run,
	owner: StarterWorkspace,
	versions: ReadonlyMap<string, { version: string; section: Section }>,
	edges: ReadonlyMap<StarterWorkspace, ReadonlySet<StarterWorkspace>>
): Record<Section, Record<string, string>> {
	const declared: Record<Section, Record<string, string>> = {
		dependencies: {},
		devDependencies: {}
	};
	for (const [name, holders] of Object.entries(DEPENDENCY_OWNERS)) {
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
export function ownerProblems(manifest: Manifest): string[] {
	return [
		...ownerTableProblems(rootVersions(manifest)),
		...scriptTableProblems(manifest.scripts ?? {})
	];
}

export function verifyOwners(run: Run): void {
	const problems = ownerProblems(run.flatManifest);
	if (problems.length) throw new StaleInput(problems.join('\n'));
}

/**
 * Derives every workspace manifest from the flat root manifest and `owners.ts`. A workspace that
 * has a manifest already keeps its fields and gains what the map gives it.
 */
export function writeManifests(run: Run, warn: (line: string) => void = console.warn): void {
	const versions = rootVersions(run.flatManifest);
	const edges = workspaceEdges(run);
	const peers: Partial<Record<StarterWorkspace, readonly string[]>> = PEER_DEPENDENCIES;
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
		const existing: Manifest | undefined = existsSync(join(run.checkout, path))
			? JSON.parse(readText(run, path))
			: undefined;
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
