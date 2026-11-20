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

export interface BundleBudget {
	unsetPublicEnv: string[];
	allowance: { marketing: number; app: number };
	routes: Record<string, ClosureSize>;
}

export interface MeasuredBuild {
	unsetPublicEnv: string[];
	measures: RouteMeasure[];
}

const NODE_FACADE = /client-optimized\/nodes\/(\d+)\.js$/;
const EFFECT_MODULE = /(?:^|\/)node_modules\/(?:effect|@effect\/[^/]+)\//;

const isMarketingRoute = (id: string) => id.split('/').includes('(marketing)');

export function measureRoutes(
	graph: ModuleGraph,
	entries: string[],
	routes: PageRoute[],
	gzipSize: (file: string) => number
): RouteMeasure[] {
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

	return routes.map(({ id, nodes }) => {
		const initial = reach([...entries, ...nodes.map(nodeFile)], (c) => c.imports, new Set());
		const lazyRoots = [...initial].flatMap((file) => chunk(file).dynamicImports);
		const lazy = reach(
			lazyRoots,
			(c) => [...c.imports, ...c.dynamicImports],
			new Set([...initial, ...routeNodes])
		);
		const initialEffectModules = [...initial]
			.flatMap((file) => chunk(file).modules)
			.filter((module) => EFFECT_MODULE.test(module))
			.sort();
		return { id, initial: sum(initial), lazy: sum(lazy), initialEffectModules };
	});
}

const sameConfiguration = (a: string[], b: string[]) =>
	a.length === b.length && a.every((name) => b.includes(name));

export function checkBudget({ unsetPublicEnv, measures }: MeasuredBuild, budget: BundleBudget) {
	const compareSizes = sameConfiguration(unsetPublicEnv, budget.unsetPublicEnv);
	const failures = measures.flatMap(({ id, initial, lazy, initialEffectModules }) => {
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
	return { failures, compareSizes };
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
		measures: measureRoutes(graph, [manifest.client.start, manifest.client.app], routes, gzipSize)
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
			allowance: previous?.allowance ?? { marketing: 1_024, app: 40_960 },
			routes: Object.fromEntries(
				build.measures
					.toSorted((a, b) => a.id.localeCompare(b.id))
					.map(({ id, initial, lazy }) => [id, { initial, lazy }])
			)
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
				? `[check-bundle-budget] ${build.measures.length} routes within ${BUDGET_FILE}.`
				: `[check-bundle-budget] ${build.measures.length} routes keep Effect out of (marketing) closures. Sizes not compared: public variables gate client code, and this build leaves [${build.unsetPublicEnv.join(', ')}] unset where ${BUDGET_FILE} was measured with [${budget.unsetPublicEnv.join(', ')}] unset.`
		);
	}
}
