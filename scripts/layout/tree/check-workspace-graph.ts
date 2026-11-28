#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, posix } from 'node:path';
import * as Graph from 'effect/Graph';
import {
	ALLOWED_EDGES,
	CONTENT_INPUTS,
	isAllowedEdge,
	SHARED_EDGES,
	WORKSPACES,
	type StarterWorkspace
} from '../../../.agents/skills/upstream-sync/layout/v3.ts';
import {
	compareCodeUnits,
	fileReferences,
	type FileReference
} from '../../../.agents/skills/upstream-sync/scripts/apply-layout.ts';
import { inPathSets, type WorkspaceRoot } from '../../path-sets.ts';

const SECTIONS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies'
] as const;
type Section = (typeof SECTIONS)[number];

export type Manifest = {
	readonly name?: string;
	readonly workspaces?: readonly string[];
	readonly imports?: Readonly<Record<string, unknown>>;
} & { readonly [S in Section]?: Readonly<Record<string, string>> };

export interface Workspace {
	readonly root: `${string}/`;
	readonly manifest: Manifest;
}

export interface Checkout {
	readonly manifest: Manifest;
	readonly workspaces: readonly Workspace[];
	readonly files: readonly string[];
	readonly text: (path: string) => string;
	readonly bunfigs: ReadonlyMap<WorkspaceRoot, unknown>;
}

export interface Source {
	readonly file: string;
	readonly workspace: Workspace;
	readonly references: readonly FileReference[];
}

export interface Judged {
	readonly files: readonly string[];
	readonly problems: readonly string[];
}

const STARTERS = new Map<string, StarterWorkspace>(
	(Object.keys(WORKSPACES) as StarterWorkspace[]).flatMap((workspace) => {
		const name = WORKSPACES[workspace].name;
		return name === null ? [] : [[name, workspace] as const];
	})
);
const READ = /\.(?:[cm]?[jt]s|[jt]sx|svelte|css)$/;
const FRAMEWORK = /^(?:\$app\/|\$env\/|\$service-worker$)/;
const BUILTINS = new Set(builtinModules);
const TESTING = /^((?:@[^/]+\/)?[^/@][^/]*)\/testing\//;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const MISSING_BY_DESIGN = new Set([
	'packages/backend/scripts/__fixtures__/convex-surface-broken/broken.ts\ta-package-that-does-not-exist'
]);
const GLOB = /[*?{[]/;

const nameOf = (workspace: Workspace) => workspace.manifest.name ?? workspace.root;

const dependenciesOf = (manifest: Manifest) =>
	SECTIONS.flatMap((section) =>
		Object.entries(manifest[section] ?? {}).map(([name, spec]) => ({ name, spec, section }))
	);

const declares = (workspace: Workspace, name: string) =>
	SECTIONS.some((section) => Object.hasOwn(workspace.manifest[section] ?? {}, name));

const typesPackage = (name: string) =>
	`@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;

const holder = (workspaces: readonly Workspace[], path: string) =>
	workspaces.find((workspace) => `${path}/`.startsWith(workspace.root));

function memberProblems(checkout: Checkout): string[] {
	const members = new Set(checkout.workspaces.map(nameOf));
	const owners = [
		{ label: 'the root manifest', manifest: checkout.manifest },
		...checkout.workspaces.map((workspace) => ({
			label: nameOf(workspace),
			manifest: workspace.manifest
		}))
	];
	return owners.flatMap(({ label, manifest }) =>
		dependenciesOf(manifest)
			.filter(
				({ name, spec }) => spec.startsWith('workspace:') || members.has(name) || STARTERS.has(name)
			)
			.flatMap(({ name, spec }) =>
				!members.has(name)
					? [`rule 4: ${label} declares ${name}, which is no workspace of this checkout`]
					: spec !== 'workspace:*'
						? [`rule 4: ${label} declares ${name} as ${spec}, not as workspace:*`]
						: []
			)
	);
}

function declaredGraph(workspaces: readonly Workspace[], keep: (from: Workspace) => boolean) {
	const index = new Map<string, Graph.NodeIndex>();
	const graph = Graph.directed<string, Section>((mutable) => {
		for (const workspace of workspaces) {
			index.set(nameOf(workspace), Graph.addNode(mutable, nameOf(workspace)));
		}
		for (const workspace of workspaces.filter(keep)) {
			for (const { name, section } of dependenciesOf(workspace.manifest)) {
				const target = index.get(name);
				if (target !== undefined) {
					Graph.addEdge(mutable, index.get(nameOf(workspace))!, target, section);
				}
			}
		}
	});
	return { graph, index };
}

const ALLOWED = (() => {
	const index = new Map<StarterWorkspace, Graph.NodeIndex>();
	const graph = Graph.directed<StarterWorkspace, null>((mutable) => {
		for (const workspace of Object.keys(ALLOWED_EDGES) as StarterWorkspace[]) {
			index.set(workspace, Graph.addNode(mutable, workspace));
		}
		for (const [from, targets] of Object.entries(ALLOWED_EDGES) as Array<
			[StarterWorkspace, readonly StarterWorkspace[]]
		>) {
			for (const to of [...targets, ...SHARED_EDGES]) {
				Graph.addEdge(mutable, index.get(from)!, index.get(to)!, null);
			}
		}
	});
	return (from: StarterWorkspace) =>
		new Set(Graph.values(Graph.bfs(graph, { start: [index.get(from)!] })));
})();

function edgeProblems(checkout: Checkout): string[] {
	const members = new Map(checkout.workspaces.map((workspace) => [nameOf(workspace), workspace]));
	const starterOf = (name: string) => (members.has(name) ? STARTERS.get(name) : undefined);
	const problems: string[] = [];
	for (const workspace of checkout.workspaces) {
		const from = starterOf(nameOf(workspace));
		if (from === undefined) continue;
		for (const { name, section } of dependenciesOf(workspace.manifest)) {
			const to = starterOf(name);
			if (to === undefined) continue;
			if (to === from || !isAllowedEdge(from, to)) {
				problems.push(`rule 1: ${nameOf(workspace)} -> ${name} is no allowed edge`);
			} else if (
				!(ALLOWED_EDGES[from] as readonly StarterWorkspace[]).includes(to) &&
				section !== 'devDependencies'
			) {
				problems.push(
					`rule 1: ${nameOf(workspace)} -> ${name} is for development only and sits in ${section}`
				);
			}
		}
	}
	const products = declaredGraph(
		checkout.workspaces,
		(workspace) => starterOf(nameOf(workspace)) === undefined
	);
	for (const workspace of checkout.workspaces) {
		const from = starterOf(nameOf(workspace));
		if (from === undefined) continue;
		const allowed = ALLOWED(from);
		for (const { name: product } of dependenciesOf(workspace.manifest)) {
			if (!members.has(product) || starterOf(product) !== undefined) continue;
			const walk = Graph.bfs(products.graph, { start: [products.index.get(product)!] });
			for (const reached of Graph.values(walk)) {
				const to = starterOf(reached);
				if (to !== undefined && to !== from && !allowed.has(to)) {
					problems.push(`rule 2: ${nameOf(workspace)} reaches ${reached} through ${product}`);
				}
			}
		}
	}
	const declared = declaredGraph(checkout.workspaces, () => true);
	if (!Graph.isAcyclic(declared.graph)) {
		const names = new Map([...declared.index].map(([name, node]) => [node, name]));
		for (const { source, target } of Graph.values(Graph.edges(declared.graph))) {
			const back = new Set(Graph.indices(Graph.bfs(declared.graph, { start: [target] })));
			if (back.has(source)) {
				problems.push(`rule 3: ${names.get(source)} -> ${names.get(target)} closes a cycle`);
			}
		}
	}
	return problems;
}

function aliasTarget(workspace: Workspace, specifier: string): string | undefined {
	for (const [key, value] of Object.entries(workspace.manifest.imports ?? {})) {
		if (typeof value !== 'string') continue;
		const star = key.indexOf('*');
		if (star === -1) {
			if (key === specifier) return posix.join(workspace.root, value);
			continue;
		}
		const [prefix, suffix] = [key.slice(0, star), key.slice(star + 1)];
		if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
			const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
			return posix.join(workspace.root, value.replace('*', middle));
		}
	}
	if (declares(workspace, '@sveltejs/kit') && /^\$lib(?:\/|$)/.test(specifier)) {
		return posix.join(workspace.root, 'src/lib', specifier.slice('$lib'.length));
	}
	return undefined;
}

const fixedPart = (pattern: string) => {
	const glob = pattern.search(GLOB);
	return glob === -1 ? pattern : pattern.slice(0, glob);
};

function pathOf(source: Source, reference: FileReference): string | undefined {
	return targetOf(source, reference)?.replace(/(.)\/$/, '$1');
}

function targetOf({ file, workspace }: Source, { kind, text }: FileReference): string | undefined {
	const directory = posix.dirname(file);
	const bare = text.split('?')[0]!.replace(/^!/, '');
	switch (kind) {
		case 'path':
			return posix.join(directory, bare);
		case 'url':
			return SCHEME.test(bare) ? undefined : posix.join(directory, bare);
		case 'glob':
			return bare.startsWith('/')
				? posix.join(workspace.root, fixedPart(bare))
				: posix.join(directory, fixedPart(bare));
		case 'source':
			return posix.join(directory, fixedPart(bare));
		case 'module':
		case 'style':
			return bare.startsWith('.') ? posix.join(directory, bare) : aliasTarget(workspace, bare);
	}
}

export function sources(checkout: Checkout): Source[] {
	return checkout.files.flatMap((file) => {
		const workspace = holder(checkout.workspaces, file);
		if (!workspace || !READ.test(file) || file.split('/').includes('node_modules')) return [];
		return [{ file, workspace, references: fileReferences(file, checkout.text(file)) }];
	});
}

export function pathProblems(checkout: Checkout, read: readonly Source[]): Judged {
	const problems: string[] = [];
	for (const source of read) {
		const starter = STARTERS.get(nameOf(source.workspace));
		const inputs: readonly string[] =
			starter && Object.hasOwn(CONTENT_INPUTS, starter)
				? CONTENT_INPUTS[starter as keyof typeof CONTENT_INPUTS]
				: [];
		for (const reference of source.references) {
			const target = pathOf(source, reference);
			if (target === undefined) continue;
			const within = `${target}/`;
			if (
				within.startsWith(source.workspace.root) ||
				inputs.some((input) => within.startsWith(input))
			)
				continue;
			const owner = target.startsWith('../')
				? 'no directory of the checkout'
				: (holder(checkout.workspaces, target)?.manifest.name ?? 'the root');
			problems.push(
				`rule 5: ${source.file}:${reference.line} names ${reference.text}, which resolves to ${target} in ${owner}, outside ${nameOf(source.workspace)}`
			);
		}
	}
	return { files: read.map(({ file }) => file), problems };
}

export function pathReads(read: readonly Source[]): string[] {
	return read.flatMap((source) =>
		source.references.flatMap((reference) => {
			const target = pathOf(source, reference);
			return target === undefined
				? []
				: [`${source.file}:${reference.line}\t${reference.kind}\t${reference.text}\t${target}`];
		})
	);
}

function packageName(workspace: Workspace, specifier: string): string | undefined {
	const bare = specifier.split('?')[0]!;
	if (/^[./#]/.test(bare) || aliasTarget(workspace, bare) !== undefined) return undefined;
	if (/^(?:virtual|node|bun):/.test(bare) || bare === 'bun') return undefined;
	if (FRAMEWORK.test(bare) && declares(workspace, '@sveltejs/kit')) return undefined;
	const segments = bare.split('/');
	const name = bare.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
	return BUILTINS.has(name) ? undefined : name;
}

export function packageProblems(read: readonly Source[]): Judged {
	const problems: string[] = [];
	for (const { file, workspace, references } of read) {
		for (const { kind, text, line, typeOnly } of references) {
			if (kind !== 'module' && kind !== 'style') continue;
			const name = packageName(workspace, text);
			if (
				name === undefined ||
				name === workspace.manifest.name ||
				MISSING_BY_DESIGN.has(`${file}\t${text}`) ||
				declares(workspace, name) ||
				(typeOnly && declares(workspace, typesPackage(name)))
			)
				continue;
			problems.push(
				`rule 6: ${file}:${line} imports ${text}, and ${nameOf(workspace)} declares no ${name}`
			);
		}
	}
	return { files: read.map(({ file }) => file), problems };
}

export function testingProblems(checkout: Checkout, read: readonly Source[]): string[] {
	const members = new Set(checkout.workspaces.map(nameOf));
	const tree = {
		layout: 'workspace',
		workspaces: checkout.workspaces.map(({ root }) => root)
	} as const;
	return read.flatMap(({ file, references }) =>
		inPathSets(tree, file, ['tests'])
			? []
			: references.flatMap(({ kind, text, line }) => {
					const name = kind === 'module' ? TESTING.exec(text)?.[1] : undefined;
					return name !== undefined && members.has(name)
						? [`testing: ${file}:${line} imports ${text} outside a suite`]
						: [];
				})
	);
}

export function bunfigProblems(checkout: Checkout): string[] {
	const roots: WorkspaceRoot[] = ['', ...checkout.workspaces.map(({ root }) => root)];
	return roots.flatMap((root) => {
		const path = `${root}bunfig.toml`;
		if (!checkout.bunfigs.has(root)) return [`rule 7: ${path} is missing`];
		const config = checkout.bunfigs.get(root);
		const env =
			typeof config === 'object' && config !== null ? Reflect.get(config, 'env') : undefined;
		return env === false ? [] : [`rule 7: ${path} holds no env = false on its root object`];
	});
}

export function graphProblems(checkout: Checkout): Judged {
	const read = sources(checkout);
	const problems = [
		...memberProblems(checkout),
		...edgeProblems(checkout),
		...pathProblems(checkout, read).problems,
		...packageProblems(read).problems,
		...testingProblems(checkout, read),
		...bunfigProblems(checkout)
	];
	return {
		files: read.map(({ file }) => file),
		problems: [...new Set(problems)].sort(compareCodeUnits)
	};
}

export function readCheckout(directory: string): Checkout {
	const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
		cwd: directory,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024
	});
	if (listed.status !== 0) throw new Error(`git ls-files failed in ${directory}: ${listed.stderr}`);
	const files = [...new Set(listed.stdout.split('\0'))]
		.filter(
			(path) =>
				path && existsSync(join(directory, path)) && statSync(join(directory, path)).isFile()
		)
		.sort(compareCodeUnits);
	const readManifest = (path: string): Manifest =>
		JSON.parse(readFileSync(join(directory, path), 'utf8'));
	const manifest = readManifest('package.json');
	const member = (path: string) =>
		(manifest.workspaces ?? []).some((pattern) =>
			pattern.endsWith('/*')
				? posix.dirname(posix.dirname(path)) === pattern.slice(0, -2)
				: posix.dirname(path) === pattern
		);
	const workspaces = files
		.filter((path) => path.endsWith('/package.json') && member(path))
		.map((path) => ({ root: `${posix.dirname(path)}/` as const, manifest: readManifest(path) }));
	const bunfigs = new Map<WorkspaceRoot, unknown>();
	for (const root of ['', ...workspaces.map((workspace) => workspace.root)] as WorkspaceRoot[]) {
		const path = join(directory, root, 'bunfig.toml');
		if (existsSync(path)) bunfigs.set(root, Bun.TOML.parse(readFileSync(path, 'utf8')));
	}
	return {
		manifest,
		workspaces,
		files,
		text: (path) => readFileSync(join(directory, path), 'utf8'),
		bunfigs
	};
}

if (import.meta.main) {
	const checkout = readCheckout(join(import.meta.dirname, '..'));
	if (process.argv.includes('--reads')) {
		for (const row of pathReads(sources(checkout))) console.log(row);
		process.exit(0);
	}
	const { files, problems } = graphProblems(checkout);
	console.log(
		`${checkout.workspaces.length} workspaces, ${files.length} files read; a path or specifier computed at run time is outside rules 5 and 6`
	);
	for (const problem of problems) console.error(problem);
	process.exit(problems.length ? 1 : 0);
}
