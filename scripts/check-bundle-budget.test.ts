import { describe, expect, it } from 'vitest';
import {
	checkBudget,
	measureRoutes,
	SUPPORT_WIDGET,
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
const PARSER_MODULE = 'node_modules/svelte-streamdown/node_modules/marked/lib/marked.esm.js';
const PRIVACY = '/[[lang]]/(marketing)/privacy';

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
		chunk('_app/immutable/chunks/effect.js', { modules: [EFFECT_MODULE] }),
		chunk('_app/immutable/chunks/parser.js', { modules: [PARSER_MODULE] })
	];
	return {
		unsetPublicEnv: UNSET,
		chunks: chunks.map((c) => ({ ...c, ...overrides[c.fileName] }))
	};
};

const SIZE = 1_000;
const measure = (graph: ModuleGraph): MeasuredBuild => ({
	unsetPublicEnv: graph.unsetPublicEnv,
	...measureRoutes(graph, ENTRIES, ROUTES, () => SIZE)
});

const budget = (routes: BundleBudget['routes']): BundleBudget => ({
	unsetPublicEnv: UNSET,
	allowance: { marketing: 0, app: 1_500, lazyChunk: 0 },
	routes,
	lazyChunks: {}
});

const unchanged = budget({
	[MARKETING]: { initial: 7 * SIZE, lazy: 2 * SIZE },
	[APP]: { initial: 8 * SIZE, lazy: 0 }
});

describe('measureRoutes', () => {
	it('sums the initial closure of entries, layouts, page and static imports, and the lazy closure', () => {
		expect(measure(baseGraph()).measures).toEqual([
			{
				id: MARKETING,
				initial: 7 * SIZE,
				lazy: 2 * SIZE,
				initialEffectModules: [],
				markdownParserModules: []
			},
			{ id: APP, initial: 8 * SIZE, lazy: 0, initialEffectModules: [], markdownParserModules: [] }
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
			checkBudget(measure(graph), { ...unchanged, allowance: { ...unchanged.allowance, app: 999 } })
				.failures
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

	describe('legal pages', () => {
		const routes: PageRoute[] = [...ROUTES, { id: PRIVACY, nodes: [0, 2, 6] }];
		const legalGraph = (parts: Partial<GraphChunk> = {}) => {
			const graph = baseGraph();
			graph.chunks.push(node(6, parts));
			return graph;
		};
		const check = (graph: ModuleGraph) =>
			checkBudget(
				{ unsetPublicEnv: UNSET, ...measureRoutes(graph, ENTRIES, routes, () => SIZE) },
				{ ...unchanged, routes: { ...unchanged.routes, [PRIVACY]: { initial: 0, lazy: 0 } } }
			).failures.filter((failure) => failure.includes('Markdown parser'));

		it('fails a legal page that ships a Markdown parser, also through a lazy chunk', () => {
			const parser = '_app/immutable/chunks/parser.js';

			expect(check(legalGraph({ imports: [parser] }))).toEqual([
				expect.stringContaining(
					`${PRIVACY}: the page reaches 1 Markdown parser modules (${PARSER_MODULE})`
				)
			]);
			expect(check(legalGraph({ dynamicImports: [parser] }))).toEqual([
				expect.stringContaining(`${PRIVACY}: the page reaches 1 Markdown parser modules`)
			]);
			expect(check(legalGraph())).toEqual([]);
		});

		it("ignores another route's parser, such as the home page's lazy support chat", () => {
			const graph = legalGraph();
			graph.chunks = graph.chunks.map((c) =>
				c.fileName === ENTRIES[1]
					? { ...c, dynamicImports: ['_app/immutable/nodes/4.js', '_app/immutable/nodes/6.js'] }
					: c.fileName === '_app/immutable/nodes/4.js'
						? { ...c, dynamicImports: ['_app/immutable/chunks/parser.js'] }
						: c
			);

			expect(check(graph)).toEqual([]);
		});
	});
});

describe('support widget', () => {
	const launcher = '_app/immutable/chunks/launcher.js';
	const widget = '_app/immutable/chunks/widget.js';
	const gallery = '_app/immutable/chunks/gallery.js';
	const shared = '_app/immutable/chunks/shared.js';
	const widgetLazy = '_app/immutable/chunks/widget-lazy.js';

	const widgetGraph = (overrides: Record<string, Partial<GraphChunk>> = {}): ModuleGraph => {
		const graph = baseGraph({
			'_app/immutable/nodes/4.js': { imports: [launcher], dynamicImports: [gallery] },
			[widget]: {
				facadeModuleId: SUPPORT_WIDGET.facade,
				imports: [
					'_app/immutable/chunks/widget-deps.js',
					'_app/immutable/chunks/runtime.js',
					shared
				]
			}
		});
		const chunks = [
			...graph.chunks,
			chunk(launcher, {
				modules: ['src/lib/components/customer-support/lazy-customer-support.svelte'],
				dynamicImports: [widget]
			}),
			chunk(gallery, { imports: [shared] }),
			chunk(shared),
			chunk(widgetLazy)
		];
		return { ...graph, chunks: chunks.map((c) => ({ ...c, ...overrides[c.fileName] })) };
	};

	const measureWidget = (
		graph: ModuleGraph,
		sizes: Record<string, number> = {}
	): MeasuredBuild => ({
		unsetPublicEnv: graph.unsetPublicEnv,
		...measureRoutes(graph, ENTRIES, ROUTES, (file) => sizes[file] ?? SIZE, [SUPPORT_WIDGET])
	});

	const widgetBudget: BundleBudget = {
		unsetPublicEnv: UNSET,
		allowance: { marketing: 1_024, app: 1_500, lazyChunk: 16_384 },
		routes: {
			[MARKETING]: { initial: 8 * SIZE, lazy: 2 * SIZE },
			[APP]: { initial: 8 * SIZE, lazy: 0 }
		},
		lazyChunks: { [SUPPORT_WIDGET.name]: { lazy: 3 * SIZE } }
	};

	it('measures the widget closure apart from the marketing lazy closure, which keeps shared chunks', () => {
		const { measures, lazyChunks } = measureWidget(widgetGraph());

		expect(measures[0]).toEqual({
			id: MARKETING,
			initial: 8 * SIZE,
			lazy: 2 * SIZE,
			initialEffectModules: [],
			markdownParserModules: []
		});
		expect(lazyChunks).toEqual([{ name: SUPPORT_WIDGET.name, lazy: 3 * SIZE }]);
		expect(checkBudget(measureWidget(widgetGraph()), widgetBudget).failures).toEqual([]);
	});

	it('fails a widget one byte over its baseline plus allowance', () => {
		const atLimit = measureWidget(widgetGraph(), { [shared]: SIZE + 16_384 });
		const over = measureWidget(widgetGraph(), { [shared]: SIZE + 16_385 });
		const sharedGrowth = { ...widgetBudget.routes[MARKETING]!, lazy: 2 * SIZE + 16_385 };
		const routes = { ...widgetBudget.routes, [MARKETING]: sharedGrowth };

		expect(checkBudget(atLimit, { ...widgetBudget, routes }).failures).toEqual([]);
		expect(checkBudget(over, { ...widgetBudget, routes }).failures).toEqual([
			`support-widget: lazy JS is 19385 B gzip, over its budget of 19384 B (3000 B baseline + 16384 B allowance).`
		]);
	});

	it('fails a marketing lazy branch that grows 1,025 B while the widget stays within its allowance', () => {
		const build = measureWidget(widgetGraph(), {
			[gallery]: SIZE + 1_025,
			'_app/immutable/chunks/widget-deps.js': SIZE + 16_000
		});

		expect(checkBudget(build, widgetBudget).failures).toEqual([
			`${MARKETING}: lazy JS is 3025 B gzip, over its budget of 3024 B (2000 B baseline + 1024 B allowance).`
		]);
	});

	it('keeps a chunk only the widget loads dynamically out of the marketing lazy closure', () => {
		const graph = widgetGraph({
			[widget]: {
				facadeModuleId: SUPPORT_WIDGET.facade,
				imports: ['_app/immutable/chunks/widget-deps.js', shared],
				dynamicImports: [widgetLazy]
			}
		});

		const { measures, lazyChunks } = measureWidget(graph);

		expect(measures[0]?.lazy).toBe(2 * SIZE);
		expect(lazyChunks).toEqual([{ name: SUPPORT_WIDGET.name, lazy: 4 * SIZE }]);
	});

	it('fails a marketing lazy branch that imports the widget root when that root grows 1,025 B', () => {
		const graph = widgetGraph({ [gallery]: { imports: [shared, widget] } });
		const branchBudget = {
			...widgetBudget,
			routes: { ...widgetBudget.routes, [MARKETING]: { initial: 8 * SIZE, lazy: 4 * SIZE } }
		};

		expect(checkBudget(measureWidget(graph), branchBudget).failures).toEqual([]);
		expect(
			checkBudget(measureWidget(graph, { [widget]: SIZE + 1_025 }), branchBudget).failures
		).toEqual([
			`${MARKETING}: lazy JS is 5025 B gzip, over its budget of 5024 B (4000 B baseline + 1024 B allowance).`
		]);
	});

	it('fails a graph without the widget root or with two', () => {
		const missing = widgetGraph({ [widget]: { facadeModuleId: null } });
		const twice = widgetGraph({ [gallery]: { facadeModuleId: SUPPORT_WIDGET.facade } });

		expect(() => measureWidget(missing)).toThrow(/0 chunks have the facade/);
		expect(() => measureWidget(twice)).toThrow(/2 chunks have the facade/);
	});

	it('fails a widget root that the marketing initial closure does not import dynamically', () => {
		const graph = widgetGraph({
			[launcher]: { dynamicImports: [] },
			[gallery]: { imports: [shared], dynamicImports: [widget] }
		});

		expect(() => measureWidget(graph)).toThrow(/no dynamic import of .*widget\.js/);
	});

	it('allows Effect in the widget and still fails Effect in the marketing initial closure', () => {
		const effectChunk = '_app/immutable/chunks/effect.js';
		const inWidget = widgetGraph({
			[widget]: {
				facadeModuleId: SUPPORT_WIDGET.facade,
				imports: ['_app/immutable/chunks/widget-deps.js', shared, effectChunk]
			}
		});
		const inLauncher = widgetGraph({
			[launcher]: { modules: ['src/launcher.js'], imports: [effectChunk], dynamicImports: [widget] }
		});
		const grownWidget = {
			...widgetBudget,
			lazyChunks: { [SUPPORT_WIDGET.name]: { lazy: 4 * SIZE } }
		};
		const grownInitial = {
			...widgetBudget,
			routes: { ...widgetBudget.routes, [MARKETING]: { initial: 9 * SIZE, lazy: 2 * SIZE } }
		};

		expect(checkBudget(measureWidget(inWidget), grownWidget).failures).toEqual([]);
		expect(checkBudget(measureWidget(inLauncher), grownInitial).failures).toEqual([
			expect.stringContaining(`${MARKETING}: the initial closure`)
		]);
	});
});
