import { describe, expect, it } from 'vitest';
import {
	checkBudget,
	measureRoutes,
	type BundleBudget,
	type MeasuredBuild,
	type PageRoute
} from './check-bundle-budget';
import type { GraphChunk, ModuleGraph } from './module-graph-plugin';

const ENTRIES = ['_app/immutable/entry/start.js', '_app/immutable/entry/app.js'];
const MARKETING = '/[[lang]]/(marketing)';
const APP = '/[[lang]]/app';
const ROUTES: PageRoute[] = [
	{ id: MARKETING, nodes: [0, 2, 4] },
	{ id: APP, nodes: [0, 3, 5] }
];
const UNSET = ['PUBLIC_SENTRY_DSN'];
const EFFECT_MODULE = 'node_modules/effect/dist/Effect.js';

const chunk = (fileName: string, parts: Partial<GraphChunk> = {}): GraphChunk => ({
	fileName,
	facadeModuleId: null,
	imports: [],
	dynamicImports: [],
	modules: [`src/${fileName}`],
	...parts
});

const node = (index: number, parts: Partial<GraphChunk> = {}) =>
	chunk(`_app/immutable/nodes/${index}.js`, {
		facadeModuleId: `.svelte-kit/generated/build/client-optimized/nodes/${index}.js`,
		...parts
	});

const baseGraph = (overrides: Record<string, Partial<GraphChunk>> = {}): ModuleGraph => {
	const chunks = [
		chunk(ENTRIES[0]!, { imports: ['_app/immutable/chunks/runtime.js'] }),
		chunk(ENTRIES[1]!, { imports: ['_app/immutable/chunks/runtime.js'] }),
		chunk('_app/immutable/chunks/runtime.js'),
		node(0, { imports: ['_app/immutable/chunks/shell.js'] }),
		node(2),
		node(3),
		node(4, { dynamicImports: ['_app/immutable/chunks/widget.js'] }),
		node(5, { imports: ['_app/immutable/chunks/flow.js'] }),
		chunk('_app/immutable/chunks/shell.js'),
		chunk('_app/immutable/chunks/flow.js'),
		chunk('_app/immutable/chunks/widget.js', {
			imports: ['_app/immutable/chunks/widget-deps.js', '_app/immutable/chunks/runtime.js']
		}),
		chunk('_app/immutable/chunks/widget-deps.js'),
		chunk('_app/immutable/chunks/effect.js', { modules: [EFFECT_MODULE] })
	];
	return {
		unsetPublicEnv: UNSET,
		chunks: chunks.map((c) => ({ ...c, ...overrides[c.fileName] }))
	};
};

const SIZE = 1_000;
const measure = (graph: ModuleGraph): MeasuredBuild => ({
	unsetPublicEnv: graph.unsetPublicEnv,
	measures: measureRoutes(graph, ENTRIES, ROUTES, () => SIZE)
});

const budget = (routes: BundleBudget['routes']): BundleBudget => ({
	unsetPublicEnv: UNSET,
	allowance: { marketing: 0, app: 1_500 },
	routes
});

const unchanged = budget({
	[MARKETING]: { initial: 7 * SIZE, lazy: 2 * SIZE },
	[APP]: { initial: 8 * SIZE, lazy: 0 }
});

describe('measureRoutes', () => {
	it('sums the initial closure of entries, layouts, page and static imports, and the lazy closure', () => {
		expect(measure(baseGraph()).measures).toEqual([
			{ id: MARKETING, initial: 7 * SIZE, lazy: 2 * SIZE, initialEffectModules: [] },
			{ id: APP, initial: 8 * SIZE, lazy: 0, initialEffectModules: [] }
		]);
	});

	it('fails on a graph that does not belong to the build', () => {
		const graph = baseGraph();
		graph.chunks = graph.chunks.filter((c) => c.fileName !== ENTRIES[1]);

		expect(() => measure(graph)).toThrow(/missing from client-module-graph.json/);
	});
});

describe('checkBudget', () => {
	it('passes the unchanged build', () => {
		expect(checkBudget(measure(baseGraph()), unchanged)).toEqual({
			failures: [],
			compareSizes: true
		});
	});

	it('fails when a marketing page imports Effect', () => {
		const graph = baseGraph({
			'_app/immutable/nodes/4.js': {
				imports: ['_app/immutable/chunks/effect.js'],
				dynamicImports: ['_app/immutable/chunks/widget.js']
			}
		});

		const { failures } = checkBudget(measure(graph), {
			...unchanged,
			routes: { ...unchanged.routes, [MARKETING]: { initial: 8 * SIZE, lazy: 2 * SIZE } }
		});

		expect(failures).toEqual([expect.stringContaining(`${MARKETING}: the initial closure`)]);
		expect(failures[0]).toContain(EFFECT_MODULE);
	});

	it('fails a marketing route when a shared layout reaches Effect through another chunk', () => {
		const graph = baseGraph({
			'_app/immutable/chunks/shell.js': { imports: ['_app/immutable/chunks/effect.js'] }
		});

		const { failures } = checkBudget(measure(graph), {
			...unchanged,
			routes: {
				[MARKETING]: { initial: 8 * SIZE, lazy: 2 * SIZE },
				[APP]: { initial: 9 * SIZE, lazy: 0 }
			}
		});

		expect(failures).toEqual([expect.stringContaining(`${MARKETING}: the initial closure`)]);
	});

	it('allows Effect in a lazy chunk of a marketing route', () => {
		const graph = baseGraph({
			'_app/immutable/chunks/widget.js': {
				imports: [
					'_app/immutable/chunks/widget-deps.js',
					'_app/immutable/chunks/runtime.js',
					'_app/immutable/chunks/effect.js'
				]
			}
		});

		const { failures } = checkBudget(measure(graph), {
			...unchanged,
			routes: { ...unchanged.routes, [MARKETING]: { initial: 7 * SIZE, lazy: 3 * SIZE } }
		});

		expect(failures).toEqual([]);
	});

	it('fails a route over its baseline plus allowance', () => {
		const graph = baseGraph({
			'_app/immutable/nodes/5.js': {
				imports: ['_app/immutable/chunks/flow.js', '_app/immutable/chunks/effect.js']
			}
		});

		expect(checkBudget(measure(graph), unchanged).failures).toEqual([]);
		expect(
			checkBudget(measure(graph), { ...unchanged, allowance: { marketing: 0, app: 999 } }).failures
		).toEqual([
			`${APP}: initial JS is 9000 B gzip, over its budget of 8999 B (8000 B baseline + 999 B allowance).`
		]);
	});

	it('fails a route without an entry', () => {
		const { failures } = checkBudget(
			measure(baseGraph()),
			budget({ [MARKETING]: unchanged.routes[MARKETING]! })
		);

		expect(failures).toEqual([expect.stringContaining(`${APP}: no entry in bundle-budget.json`)]);
	});

	it('compares sizes only on a build with the configuration the budget measured', () => {
		const graph = { ...baseGraph(), unsetPublicEnv: [] };
		const tight = budget({
			[MARKETING]: { initial: SIZE, lazy: 0 },
			[APP]: { initial: SIZE, lazy: 0 }
		});

		expect(checkBudget(measure(graph), tight)).toEqual({ failures: [], compareSizes: false });
		expect(checkBudget(measure(baseGraph()), tight).failures).toHaveLength(3);
	});
});
