import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MODULE_GRAPH_FILE, type GraphChunk, type ModuleGraph } from './module-graph-plugin';

const BUDGET_FILE = 'bundle-budget.json';

export interface PageRoute {
	id: string;
	nodes: number[];
}

interface ClosureSize {
	initial: number;
	lazy: number;
}

export interface RouteMeasure extends ClosureSize {
	id: string;
	initialEffectModules: string[];
}

export interface LazyChunk {
	name: string;
	route: string;
	facade: string;
}

export interface LazyChunkMeasure {
	name: string;
	lazy: number;
}

export interface BundleBudget {
	unsetPublicEnv: string[];
	allowance: { marketing: number; app: number; lazyChunk: number };
	routes: Record<string, ClosureSize>;
	lazyChunks: Record<string, Pick<ClosureSize, 'lazy'>>;
}

export interface MeasuredBuild {
	unsetPublicEnv: string[];
	measures: RouteMeasure[];
	lazyChunks: LazyChunkMeasure[];
}

export const SUPPORT_WIDGET: LazyChunk = {
	name: 'support-widget',
	route: '/[[lang]]/(marketing)',
	facade: 'src/lib/components/customer-support/customer-support.svelte'
};

const NODE_FACADE = /client-optimized\/nodes\/(\d+)\.js$/;
const EFFECT_MODULE = /(?:^|\/)node_modules\/(?:effect|@effect\/[^/]+)\//;

const isMarketingRoute = (id: string) => id.split('/').includes('(marketing)');

export function measureRoutes(
	graph: ModuleGraph,
	entries: string[],
	routes: PageRoute[],
	gzipSize: (file: string) => number,
	lazyChunks: readonly LazyChunk[] = []
): Pick<MeasuredBuild, 'measures' | 'lazyChunks'> {
	const byFile = new Map(graph.chunks.map((chunk) => [chunk.fileName, chunk]));
	const chunk = (file: string): GraphChunk => {
		const found = byFile.get(file);
		if (!found) throw new Error(`${file} is missing from ${MODULE_GRAPH_FILE}; rebuild first`);
		return found;
	};
	const nodeFiles = new Map<number, string>();
	for (const { fileName, facadeModuleId } of graph.chunks) {
		const node = facadeModuleId?.match(NODE_FACADE)?.[1];
		if (node !== undefined) nodeFiles.set(Number(node), fileName);
	}
	const nodeFile = (node: number) => {
		const file = nodeFiles.get(node);
		if (!file) throw new Error(`Route node ${node} has no chunk in ${MODULE_GRAPH_FILE}`);
		return file;
	};
	const routeNodes = new Set(nodeFiles.values());

	const reach = (roots: string[], edges: (chunk: GraphChunk) => string[], skip: Set<string>) => {
		const seen = new Set<string>();
		const stack = roots.filter((file) => !skip.has(file));
		for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
			if (seen.has(file)) continue;
			seen.add(file);
			stack.push(...edges(chunk(file)).filter((next) => !skip.has(next) && !seen.has(next)));
		}
		return seen;
	};
	const sum = (files: Set<string>) => [...files].reduce((total, file) => total + gzipSize(file), 0);

	const lazyChunkRoot = (spec: LazyChunk, lazyRoots: string[]) => {
		const roots = graph.chunks.filter(({ facadeModuleId }) => facadeModuleId === spec.facade);
		if (roots.length !== 1) {
			throw new Error(
				`${spec.name}: ${roots.length} chunks have the facade ${spec.facade} in ${MODULE_GRAPH_FILE}; expected 1`
			);
		}
		const root = roots[0]!.fileName;
		if (!lazyRoots.includes(root)) {
			throw new Error(
				`${spec.name}: no dynamic import of ${root} from the ${spec.route} initial closure`
			);
		}
		return root;
	};

	const lazyChunkMeasures: LazyChunkMeasure[] = [];
	const measures = routes.map(({ id, nodes }) => {
		const initial = reach([...entries, ...nodes.map(nodeFile)], (c) => c.imports, new Set());
		const lazyRoots = [...initial].flatMap((file) => chunk(file).dynamicImports);
		const lazySkip = new Set([...initial, ...routeNodes]);
		const lazyEdges = (c: GraphChunk) => [...c.imports, ...c.dynamicImports];
		const carved = lazyChunks
			.filter((spec) => spec.route === id)
			.map((spec) => ({ spec, root: lazyChunkRoot(spec, lazyRoots) }));
		for (const { spec, root } of carved) {
			lazyChunkMeasures.push({ name: spec.name, lazy: sum(reach([root], lazyEdges, lazySkip)) });
		}
		const carvedRoots = new Set(carved.map(({ root }) => root));
		const lazy = reach(
			lazyRoots.filter((file) => !carvedRoots.has(file)),
			lazyEdges,
			lazySkip
		);
		const initialEffectModules = [...initial]
			.flatMap((file) => chunk(file).modules)
			.filter((module) => EFFECT_MODULE.test(module))
			.sort();
		return { id, initial: sum(initial), lazy: sum(lazy), initialEffectModules };
	});
	const unmeasured = lazyChunks.filter(
		(spec) => !lazyChunkMeasures.some(({ name }) => name === spec.name)
	);
	if (unmeasured.length > 0) {
		throw new Error(`${unmeasured.map(({ route }) => route).join(', ')}: no such route`);
	}
	return { measures, lazyChunks: lazyChunkMeasures };
}

const sameConfiguration = (a: string[], b: string[]) =>
	a.length === b.length && a.every((name) => b.includes(name));

export function checkBudget(
	{ unsetPublicEnv, measures, lazyChunks }: MeasuredBuild,
	budget: BundleBudget
) {
	const compareSizes = sameConfiguration(unsetPublicEnv, budget.unsetPublicEnv);
	const routeFailures = measures.flatMap(({ id, initial, lazy, initialEffectModules }) => {
		const found: string[] = [];
		const marketing = isMarketingRoute(id);
		if (marketing && initialEffectModules.length > 0) {
			const listed = initialEffectModules.slice(0, 5).join(', ');
			found.push(
				`${id}: the initial closure of a (marketing) route holds ${initialEffectModules.length} Effect modules (${listed}). Keep Effect out of marketing pages and every layout above them; load it lazily.`
			);
		}
		const entry = budget.routes[id];
		if (!entry) {
			found.push(
				`${id}: no entry in ${BUDGET_FILE}. Add one with the sizes of a build with unset public variables [${budget.unsetPublicEnv.join(', ')}].`
			);
			return found;
		}
		if (!compareSizes) return found;
		const allowance = marketing ? budget.allowance.marketing : budget.allowance.app;
		for (const [closure, measured] of [
			['initial', initial],
			['lazy', lazy]
		] as const) {
			const limit = entry[closure] + allowance;
			if (measured > limit) {
				found.push(
					`${id}: ${closure} JS is ${measured} B gzip, over its budget of ${limit} B (${entry[closure]} B baseline + ${allowance} B allowance).`
				);
			}
		}
		return found;
	});
	const lazyChunkFailures = lazyChunks.flatMap(({ name, lazy }) => {
		const entry = budget.lazyChunks[name];
		if (!entry) return [`${name}: no lazy chunk entry in ${BUDGET_FILE}.`];
		const limit = entry.lazy + budget.allowance.lazyChunk;
		if (!compareSizes || lazy <= limit) return [];
		return [
			`${name}: lazy JS is ${lazy} B gzip, over its budget of ${limit} B (${entry.lazy} B baseline + ${budget.allowance.lazyChunk} B allowance).`
		];
	});
	return { failures: [...routeFailures, ...lazyChunkFailures], compareSizes };
}

interface KitManifest {
	client: { start: string; app: string };
	routes: Array<{ id: string; page: { layouts: Array<number | undefined>; leaf: number } | null }>;
}

async function measureBuild(outputDir: string): Promise<MeasuredBuild> {
	const clientDir = path.join(outputDir, 'client');
	const graph: ModuleGraph = JSON.parse(
		fs.readFileSync(path.join(outputDir, MODULE_GRAPH_FILE), 'utf8')
	);
	const { manifest }: { manifest: KitManifest } = await import(
		path.join(outputDir, 'server', 'manifest.js')
	);
	const routes = manifest.routes.flatMap(({ id, page }) =>
		page ? [{ id, nodes: [...page.layouts, page.leaf].filter((node) => node !== undefined) }] : []
	);
	const sizes = new Map<string, number>();
	const gzipSize = (file: string) => {
		const cached = sizes.get(file);
		if (cached !== undefined) return cached;
		const size = zlib.gzipSync(fs.readFileSync(path.join(clientDir, file)), { level: 9 }).length;
		sizes.set(file, size);
		return size;
	};
	return {
		unsetPublicEnv: graph.unsetPublicEnv,
		...measureRoutes(graph, [manifest.client.start, manifest.client.app], routes, gzipSize, [
			SUPPORT_WIDGET
		])
	};
}

if (import.meta.main) {
	const budgetPath = path.join(process.cwd(), BUDGET_FILE);
	const build = await measureBuild(path.join(process.cwd(), '.svelte-kit', 'output'));
	if (process.argv.includes('--write')) {
		const previous: BundleBudget | undefined = fs.existsSync(budgetPath)
			? JSON.parse(fs.readFileSync(budgetPath, 'utf8'))
			: undefined;
		const budget: BundleBudget = {
			unsetPublicEnv: build.unsetPublicEnv,
			allowance: { marketing: 1_024, app: 40_960, lazyChunk: 16_384, ...previous?.allowance },
			routes: Object.fromEntries(
				build.measures
					.toSorted((a, b) => a.id.localeCompare(b.id))
					.map(({ id, initial, lazy }) => [id, { initial, lazy }])
			),
			lazyChunks: Object.fromEntries(build.lazyChunks.map(({ name, lazy }) => [name, { lazy }]))
		};
		fs.writeFileSync(budgetPath, `${JSON.stringify(budget, null, '\t')}\n`);
		console.log(`[check-bundle-budget] Wrote ${build.measures.length} routes to ${BUDGET_FILE}.`);
	} else {
		const budget: BundleBudget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
		const { failures, compareSizes } = checkBudget(build, budget);
		if (failures.length > 0) {
			console.error(`[check-bundle-budget] ${failures.length} failure(s):\n${failures.join('\n')}`);
			process.exit(1);
		}
		console.log(
			compareSizes
				? `[check-bundle-budget] ${build.measures.length} routes and ${build.lazyChunks.length} lazy chunk(s) within ${BUDGET_FILE}.`
				: `[check-bundle-budget] ${build.measures.length} routes keep Effect out of (marketing) closures. Sizes not compared: public variables gate client code, and this build leaves [${build.unsetPublicEnv.join(', ')}] unset where ${BUDGET_FILE} was measured with [${budget.unsetPublicEnv.join(', ')}] unset.`
		);
	}
}
