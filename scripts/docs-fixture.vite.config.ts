/**
 * The repository's vite.config.ts with the docs fixture catalog and output paths of its own.
 * SvelteKit's prerender step loads the build's config file again, so the redirected output
 * directory lives in this file, not in memory. scripts/docs-fixture.ts selects the catalog
 * variant through DOCS_FIXTURE_VARIANT.
 */
import path from 'node:path';
import adapterNode from '@sveltejs/adapter-node';
import { defineConfig, normalizePath, type Plugin, type PluginOption } from 'vite';
import repositoryConfig from '../vite.config';
import {
	fixtureKitOutput,
	fixtureServerDir,
	isVariant,
	VARIANTS,
	type Variant
} from './docs-fixture';
import { MODULE_GRAPH_FILE, type ModuleGraphOptions } from './module-graph-plugin';

const root = path.resolve(import.meta.dirname, '..');
const fixtureCatalogs = normalizePath(path.join(root, 'src/lib/docs/__fixtures__/catalogs.ts'));
const fixtureSource = normalizePath(path.join(root, 'src/lib/docs/__fixtures__/fixture-docs.ts'));

function fixtureCatalog(variant: Variant): Plugin {
	const prefix = '\0docs-fixture:';
	const modules = new Map([
		[
			normalizePath(path.join(root, 'src/lib/docs/catalog.ts')),
			`export { ${VARIANTS[variant]} as docsCatalog } from ${JSON.stringify(fixtureCatalogs)};`
		],
		[
			normalizePath(path.join(root, 'src/lib/docs/source.server.ts')),
			`export { fixtureDocs as repositoryDocs } from ${JSON.stringify(fixtureSource)};`
		]
	]);
	return {
		name: 'docs-fixture-catalog',
		enforce: 'pre',
		async resolveId(id, importer, options) {
			if (!/(?:catalog|source\.server)(?:\.[jt]s)?$/.test(id)) return null;
			const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
			const file = resolved && normalizePath(resolved.id.split('?')[0]!);
			return file && modules.has(file) ? `${prefix}${file}` : null;
		},
		load(id) {
			return id.startsWith(prefix) ? modules.get(id.slice(prefix.length)) : null;
		}
	};
}

async function flatten(options: PluginOption[]): Promise<Plugin[]> {
	const plugins: Plugin[] = [];
	for (const option of await Promise.all(options)) {
		if (Array.isArray(option)) plugins.push(...(await flatten(option)));
		else if (option) plugins.push(option);
	}
	return plugins;
}

export default defineConfig(async (env) => {
	const variant = process.env.DOCS_FIXTURE_VARIANT ?? '';
	if (!isVariant(variant)) throw new Error(`DOCS_FIXTURE_VARIANT names no variant: ${variant}`);
	const config = await repositoryConfig(env);
	const plugins = await flatten(config.plugins ?? []);
	const kit = plugins.find(({ name }) => name === 'vite-plugin-sveltekit-setup');
	const graph = plugins.find(({ name }) => name === 'client-module-graph');
	if (!kit?.api?.options || !graph?.api?.options) {
		throw new Error('vite.config.ts no longer registers the SvelteKit or module graph plugin');
	}
	kit.api.options.outDir = path.dirname(fixtureKitOutput);
	kit.api.options.adapter = adapterNode({ out: fixtureServerDir });
	const graphOptions: ModuleGraphOptions = graph.api.options;
	graphOptions.outFile = path.join(fixtureKitOutput, MODULE_GRAPH_FILE);
	return { ...config, plugins: [...plugins, fixtureCatalog(variant)] };
});
