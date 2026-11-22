// @vitest-environment node
/// <reference types="vite/client" />
import { HttpRouter } from '@confect/server';
import {
	httpRouter,
	ROUTABLE_HTTP_METHODS,
	type HttpRouter as ConvexHttpRouter
} from 'convex/server';
import * as Layer from 'effect/Layer';
import { describe, expect, it } from 'vitest';
import nativeRouter from '../convex/http';
import { convexModules } from './convexTest.modules';
import { digest, goldenText, isJsonList, type Json } from './goldens';

const NATIVE = '../convex/';
const AUTHORED_ENTRY_FILES = new Set([
	'schema.ts',
	'http.ts',
	'crons.ts',
	'auth.config.ts',
	'convex.config.ts'
]);

const CONFECT_CATCH_ALL = '/*';

const golden = (name: string) => `./__goldens__/${name}`;

type Registered = {
	isQuery?: boolean;
	isMutation?: boolean;
	isAction?: boolean;
	isPublic?: boolean;
	isInternal?: boolean;
	exportArgs: () => string;
	exportReturns: () => string;
};

function isRegistered(value: unknown): value is Registered {
	return (
		typeof value === 'function' &&
		'exportArgs' in value &&
		typeof value.exportArgs === 'function' &&
		'exportReturns' in value &&
		typeof value.exportReturns === 'function'
	);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null;
}

function isJson(value: unknown): value is Json {
	if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return true;
	if (Array.isArray(value)) return value.every(isJson);
	return isRecord(value) && Object.values(value).every(isJson);
}

function json(value: unknown, what: string): Json {
	if (!isJson(value)) throw new Error(`${what} is not JSON`);
	return value;
}

async function moduleExports(key: string): Promise<Readonly<Record<string, unknown>>> {
	const loader = convexModules[key];
	if (!loader) throw new Error(`${key} is missing`);
	const loaded = await loader();
	if (!isRecord(loaded)) throw new Error(`${key} is not a module`);
	return loaded;
}

async function defaultExport(file: string): Promise<unknown> {
	return (await moduleExports(`${NATIVE}${file}`)).default;
}

function kindOf(registered: Registered): string {
	if (registered.isQuery) return 'query';
	if (registered.isMutation) return 'mutation';
	if (registered.isAction) return 'action';
	return 'unknown';
}

function visibilityOf(registered: Registered): string {
	if (registered.isPublic) return 'public';
	if (registered.isInternal) return 'internal';
	return 'unknown';
}

async function publishedRegistrations() {
	const modules: Record<string, Record<string, readonly string[]>> = {};
	for (const key of Object.keys(convexModules).sort()) {
		const file = key.slice(NATIVE.length);
		if (file.startsWith('_generated/') || AUTHORED_ENTRY_FILES.has(file)) continue;
		const module = file.replace(/\.ts$/, '');
		for (const [name, value] of Object.entries(await moduleExports(key)).sort(([a], [b]) =>
			a < b ? -1 : a > b ? 1 : 0
		)) {
			if (!isRegistered(value)) continue;
			modules[module] = {
				...modules[module],
				[name]: [
					visibilityOf(value),
					kindOf(value),
					digest(json(JSON.parse(value.exportArgs()), `${module}:${name} args`)),
					digest(json(JSON.parse(value.exportReturns()), `${module}:${name} returns`))
				]
			};
		}
	}
	return modules;
}

type JsonObject = { readonly [key: string]: Json };

function object(value: Json | undefined, what: string): JsonObject {
	if (typeof value !== 'object' || value === null || isJsonList(value)) {
		throw new Error(`${what} is not an object`);
	}
	return value;
}

function list(value: Json | undefined, what: string): readonly Json[] {
	if (!isJsonList(value)) throw new Error(`${what} is not a list`);
	return value;
}

function schemaGolden(exported: Json): Json {
	const { tables, ...settings } = object(exported, 'the schema');
	const tableList = list(tables, 'the schema tables');
	const counts: Record<string, number> = { tables: tableList.length };
	const byName = Object.fromEntries(
		tableList.map((table) => {
			const { tableName, documentType, ...indexGroups } = object(table, 'a table');
			const groups = Object.entries(indexGroups).flatMap(([group, entries]) => {
				const indexes = list(entries, `${String(tableName)} ${group}`);
				counts[group] = (counts[group] ?? 0) + indexes.length;
				if (indexes.length === 0) return [];
				return [
					[
						group,
						Object.fromEntries(
							indexes.map((index) => {
								const { indexDescriptor, ...definition } = object(index, 'an index');
								return [String(indexDescriptor), definition];
							})
						)
					]
				];
			});
			return [
				String(tableName),
				{ documentType: digest(documentType ?? null), ...Object.fromEntries(groups) }
			];
		})
	);
	return { counts, ...settings, tables: byName };
}

function exportedSchema(value: unknown): Json {
	if (!isRecord(value) || !('export' in value) || typeof value.export !== 'function') {
		throw new Error('schema.ts does not default-export a schema definition');
	}
	return json(JSON.parse(String(value.export())), 'the exported schema');
}

function cronsGolden(value: unknown): Json {
	const crons = isRecord(value) ? value.crons : undefined;
	if (!isRecord(crons)) throw new Error('crons.ts does not default-export cron jobs');
	return json(
		Object.fromEntries(
			Object.entries(crons).map(([name, cron]) => [
				name,
				isRecord(cron) ? { function: cron.name, schedule: cron.schedule, args: cron.args } : cron
			])
		),
		'the cron jobs'
	);
}

function routesGolden(value: unknown): Json {
	if (!isRecord(value) || !('getRoutes' in value) || typeof value.getRoutes !== 'function') {
		throw new Error('http.ts does not default-export an HTTP router');
	}
	const listed: unknown = value.getRoutes();
	if (!Array.isArray(listed)) throw new Error('the router returned no route list');
	const routes: readonly unknown[] = listed;
	const catchAllMethods = routes
		.filter(isConfectCatchAll)
		.map(([, method]) => String(method))
		.sort();
	if (
		catchAllMethods.length > 0 &&
		catchAllMethods.join() !== [...ROUTABLE_HTTP_METHODS].sort().join()
	) {
		throw new Error(`the router has a Confect catch-all for ${catchAllMethods.join(', ')} only`);
	}
	return routes
		.filter((route) => !isConfectCatchAll(route))
		.map((route) => (Array.isArray(route) ? `${route[1]} ${route[0]}` : String(route)))
		.sort();
}

function isConfectCatchAll(route: unknown): route is readonly unknown[] {
	return Array.isArray(route) && route[0] === CONFECT_CATCH_ALL;
}

type Routes = ReturnType<ConvexHttpRouter['getRoutes']>;

function withRoutes(router: ConvexHttpRouter, routes: Routes): ConvexHttpRouter {
	for (const [path, method, handler] of routes) {
		router.route(
			path.endsWith('*')
				? { pathPrefix: path.slice(0, -1), method, handler }
				: { path, method, handler }
		);
	}
	return router;
}

describe('Convex goldens', () => {
	it('keep every published registration with its validators', async () => {
		await expect(
			await goldenText({
				columns: ['visibility', 'kind', 'args digest', 'returns digest'],
				modules: await publishedRegistrations()
			})
		).toMatchFileSnapshot(golden('registrations.json'));
	});

	it('keep the schema tables and indexes', async () => {
		await expect(
			await goldenText(schemaGolden(exportedSchema(await defaultExport('schema.ts'))))
		).toMatchFileSnapshot(golden('schema.json'));
	});

	it('keep the cron names, schedules and targets', async () => {
		await expect(
			await goldenText(cronsGolden(await defaultExport('crons.ts')))
		).toMatchFileSnapshot(golden('crons.json'));
	});

	it('keep the HTTP routes', async () => {
		await expect(
			await goldenText(routesGolden(await defaultExport('http.ts')))
		).toMatchFileSnapshot(golden('http-routes.json'));
	});
});

describe('the HTTP route golden', () => {
	const routes = nativeRouter.getRoutes();

	it('accepts the application routes behind the complete Confect catch-all', () => {
		expect(routesGolden(withRoutes(HttpRouter.make(Layer.empty), routes))).toEqual(
			routesGolden(nativeRouter)
		);
	});

	it('rejects a Confect router without an application route', () => {
		const withoutInline = routes.filter(([path]) => path !== '/files/inline');

		expect(routesGolden(withRoutes(HttpRouter.make(Layer.empty), withoutInline))).not.toEqual(
			routesGolden(nativeRouter)
		);
	});

	it('rejects a catch-all for only some methods', () => {
		const [[, , handler]] = routes;
		const partial = withRoutes(httpRouter(), routes);
		partial.route({ pathPrefix: '/', method: 'GET', handler });
		partial.route({ pathPrefix: '/', method: 'POST', handler });

		expect(() => routesGolden(partial)).toThrow('Confect catch-all for GET, POST only');
	});
});
