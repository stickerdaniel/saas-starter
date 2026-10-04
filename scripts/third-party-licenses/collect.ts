import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as v from 'valibot';
import type { Plugin, ResolvedConfig, Rolldown } from 'vite';
import {
	CATALOGUE_JSON_FILE,
	CATALOGUE_TEXT_FILE,
	catalogueSchema,
	type Catalogue
} from '../../src/lib/licenses/catalogue';
import { loadThirdPartyLicensesConfig, type ThirdPartyLicensesConfig } from './config';
import { findCssPackageInputs, findServiceWorkerEntry, uncoveredCssInputProblems } from './inputs';
import { resolveThirdPartyNotices, type ShippedInput } from './resolve';
import { buildCatalogue, serializeCatalogueJson, serializeCatalogueText } from './serialize';

export interface ThirdPartyLicensesOptions {
	/** Configuration file, relative to the Vite root. */
	configFile?: string;
	/** Directories, relative to the Vite root, whose CSS package directives must be covered. */
	cssDirectories?: string[];
}

/** What one worker build shipped, captured before Vite folds it into the parent. */
export interface WorkerRecord {
	facadeModuleId: string;
	entryFileName: string;
	moduleIds: string[];
	assetFiles: string[];
}

function chunks(bundle: Rolldown.OutputBundle): Rolldown.OutputChunk[] {
	return Object.values(bundle).filter((output) => output.type === 'chunk');
}

function assetFiles(bundle: Rolldown.OutputBundle, root: string): string[] {
	return Object.values(bundle).flatMap((output) =>
		output.type === 'asset' ? output.originalFileNames.map((name) => path.resolve(root, name)) : []
	);
}

/** The worker source an inline wrapper id (`/w.js?worker&inline`) embeds, or null. */
function inlineWorkerTarget(id: string): string | null {
	const query = id.indexOf('?');
	if (query === -1) return null;
	const params = new URLSearchParams(id.slice(query + 1));
	if (!params.has('inline') || !(params.has('worker') || params.has('sharedworker'))) return null;
	return id.slice(0, query);
}

/**
 * Workers whose code survives into the parent output. An external worker ships
 * when its entry file is still in the parent bundle after Vite pruned dead
 * workers; an inline worker ships when its wrapper module is in a shipped chunk.
 * Inline admission repeats over admitted workers' modules to reach nested ones.
 */
export function admitWorkers(
	parentModuleIds: readonly string[],
	parentFileNames: ReadonlySet<string>,
	workers: readonly WorkerRecord[]
): WorkerRecord[] {
	const admitted = new Set(workers.filter((worker) => parentFileNames.has(worker.entryFileName)));
	const targets = new Set<string>();
	const scan = (ids: readonly string[]) => {
		for (const id of ids) {
			const target = inlineWorkerTarget(id);
			if (target) targets.add(target);
		}
	};
	scan(parentModuleIds);
	for (const worker of admitted) scan(worker.moduleIds);
	let changed = true;
	while (changed) {
		changed = false;
		for (const worker of workers) {
			if (admitted.has(worker) || !targets.has(worker.facadeModuleId)) continue;
			admitted.add(worker);
			scan(worker.moduleIds);
			changed = true;
		}
	}
	return workers.filter((worker) => admitted.has(worker));
}

function shippedInputs(
	bundle: Rolldown.OutputBundle,
	root: string,
	workers: readonly WorkerRecord[]
): ShippedInput[] {
	const parentModuleIds = chunks(bundle).flatMap((chunk) => chunk.moduleIds);
	const inputs: ShippedInput[] = [
		...parentModuleIds.map((id) => ({ id, component: 'client' })),
		...assetFiles(bundle, root).map((id) => ({ id, component: 'client' }))
	];
	for (const worker of admitWorkers(parentModuleIds, new Set(Object.keys(bundle)), workers)) {
		for (const id of [...worker.moduleIds, ...worker.assetFiles]) {
			inputs.push({ id, component: 'client-worker' });
		}
	}
	return inputs;
}

function kitSetting(config: ResolvedConfig, name: string, read: (kit: KitOptions) => unknown) {
	const setup = config.plugins.find((plugin) => plugin.name === 'vite-plugin-sveltekit-setup');
	const kit = (setup?.api as { options?: { kit?: KitOptions } })?.options?.kit;
	const value = kit && read(kit);
	if (typeof value !== 'string') {
		throw new Error(
			`[third-party-licenses] Cannot read ${name} from the SvelteKit Vite plugin. Use this plugin together with sveltekit().`
		);
	}
	return path.resolve(config.root, value);
}

interface KitOptions {
	outDir?: unknown;
	files?: { serviceWorker?: unknown };
}

const kitServiceWorkerSetting = (config: ResolvedConfig) =>
	kitSetting(config, 'kit.files.serviceWorker', (kit) => kit.files?.serviceWorker);

/** Where Kit's client build writes, and so where the published catalogue lands. */
const kitClientOutput = (config: ResolvedConfig) =>
	path.join(
		kitSetting(config, 'kit.outDir', (kit) => kit.outDir),
		'output',
		'client'
	);

// Server code imports the catalogue from this module; see src/third-party-licenses.d.ts.
const SERVER_CATALOGUE_MODULE = 'virtual:third-party-licenses/server';
const SERVER_CATALOGUE_STUB = `\0${SERVER_CATALOGUE_MODULE}`;
// The SSR build leaves this import external, and the handoff writes the package
// into the server output, where adapters and Wrangler resolve it like any other.
const SERVER_CATALOGUE_PACKAGE = '@saas-starter-internal/third-party-licenses';
const SERVER_CATALOGUE_FILTER = { id: /^virtual:third-party-licenses\/server$/ };

function serverOnlyError(): never {
	throw new Error(
		`[third-party-licenses] ${SERVER_CATALOGUE_MODULE} is server-only. Import it from a server load function; browser code and workers receive the catalogue through load data.`
	);
}

/** Write the validated catalogue as a private ESM package into the server output. */
function writeServerCatalogue(clientDir: string, serverDir: string) {
	const file = path.join(clientDir, CATALOGUE_JSON_FILE);
	let catalogue: Catalogue;
	try {
		catalogue = v.parse(catalogueSchema, JSON.parse(readFileSync(file, 'utf8')));
	} catch (error) {
		throw new Error(
			`[third-party-licenses] Cannot hand ${file} to the server build: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
	const directory = path.join(serverDir, 'node_modules', ...SERVER_CATALOGUE_PACKAGE.split('/'));
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		path.join(directory, 'package.json'),
		`${JSON.stringify(
			{
				name: SERVER_CATALOGUE_PACKAGE,
				version: '0.0.0',
				private: true,
				type: 'module',
				main: './index.js',
				exports: './index.js'
			},
			null,
			'\t'
		)}\n`
	);
	writeFileSync(path.join(directory, 'index.js'), `export default ${JSON.stringify(catalogue)};\n`);
}

/**
 * Collect third-party notices for the client build and hand them to the server
 * build. Returns the parent plugin and a factory for `worker.plugins`; call this
 * once per Vite config factory invocation so the two share one accumulator.
 *
 * The parent plugin also runs in dev and Vitest, where it only resolves
 * `virtual:third-party-licenses/server` to `null`: no build has collected notices.
 */
export function thirdPartyLicenses(options: ThirdPartyLicensesOptions = {}): {
	plugin: Plugin;
	workerPlugin: () => Plugin;
} {
	const configFile = options.configFile ?? 'third-party-licenses.config.json';
	const cssDirectories = options.cssDirectories ?? ['src'];
	const workers: WorkerRecord[] = [];
	let config: ResolvedConfig;
	let licenseConfig: ThirdPartyLicensesConfig | undefined;
	let active = false;

	const isServerBuild = (environment: { name: string }) =>
		config.command === 'build' && environment.name === 'ssr' && !config.isWorker;

	const plugin: Plugin = {
		name: 'third-party-licenses',
		configResolved(resolved) {
			config = resolved;
		},
		resolveId: {
			filter: SERVER_CATALOGUE_FILTER,
			handler() {
				if (config.command === 'serve') return SERVER_CATALOGUE_STUB;
				if (!isServerBuild(this.environment)) serverOnlyError();
				return { id: SERVER_CATALOGUE_PACKAGE, external: true };
			}
		},
		load: {
			filter: { id: /^\0virtual:third-party-licenses\/server$/ },
			handler() {
				return 'export default null;\n';
			}
		},
		buildStart() {
			active = false;
			if (config.command !== 'build') return;
			// Only the browser build publishes a catalogue. Vite names worker builds
			// `client` too, so the worker flag is checked as well.
			active = this.environment.name === 'client' && !config.isWorker;
			if (!active) return;
			if (config.build.watch) {
				this.error(
					'[third-party-licenses] Watch builds are not supported: Vite reuses cached worker bundles across rebuilds, so notices would be incomplete. Run a one-shot build.'
				);
			}
			workers.length = 0;
			const serviceWorker = findServiceWorkerEntry(kitServiceWorkerSetting(config));
			if (serviceWorker) {
				this.error(
					`[third-party-licenses] ${path.relative(config.root, serviceWorker)} is a service worker entry. SvelteKit builds it without user plugins, so its third-party notices are not collected yet. Extend scripts/third-party-licenses before shipping a service worker.`
				);
			}
			// Validate the configuration before bundling rather than after it.
			licenseConfig = loadThirdPartyLicensesConfig(
				path.resolve(config.root, configFile),
				config.root
			);
		},
		generateBundle: {
			// After vite:worker has removed the files of dead workers.
			order: 'post',
			handler(_outputOptions, bundle) {
				if (!active || !licenseConfig) return;
				const root = config.root;
				const configName = path
					.relative(root, path.resolve(root, configFile))
					.replaceAll('\\', '/');
				const cssProblems = uncoveredCssInputProblems(
					findCssPackageInputs(root, cssDirectories),
					licenseConfig.extraPackages,
					configName
				);
				const result = resolveThirdPartyNotices({
					root,
					config: licenseConfig,
					shipped: shippedInputs(bundle, root, workers),
					configFileName: configName
				});
				for (const warning of result.warnings) this.warn(warning);
				const errors = [...result.errors, ...cssProblems];
				if (errors.length) this.error(`[third-party-licenses]\n${errors.join('\n\n')}`);

				const catalogue = buildCatalogue(result.entries);
				this.emitFile({
					type: 'asset',
					fileName: CATALOGUE_JSON_FILE,
					source: serializeCatalogueJson(catalogue)
				});
				this.emitFile({
					type: 'asset',
					fileName: CATALOGUE_TEXT_FILE,
					source: serializeCatalogueText(catalogue)
				});
			}
		},
		writeBundle: {
			// After Kit's own writeBundle, which awaits the nested client build, and
			// before Kit's closeBundle runs the adapter, which copies the server output.
			// A failed build never gets here, so its own error stays the one reported;
			// closeBundle would also run after a failed write.
			order: 'post',
			sequential: true,
			handler() {
				if (!isServerBuild(this.environment)) return;
				writeServerCatalogue(
					kitClientOutput(config),
					path.resolve(config.root, this.environment.config.build.outDir)
				);
			}
		}
	};

	const workerPlugin = (): Plugin => {
		let root = process.cwd();
		return {
			name: 'third-party-licenses:worker',
			apply: 'build',
			configResolved(resolved) {
				root = resolved.root;
			},
			resolveId: {
				filter: SERVER_CATALOGUE_FILTER,
				handler() {
					serverOnlyError();
				}
			},
			generateBundle: {
				order: 'post',
				handler(_outputOptions, bundle) {
					const outputs = chunks(bundle);
					const moduleIds = outputs.flatMap((chunk) => chunk.moduleIds);
					const files = assetFiles(bundle, root);
					for (const entry of outputs) {
						if (!entry.isEntry || !entry.facadeModuleId) continue;
						workers.push({
							facadeModuleId: entry.facadeModuleId,
							entryFileName: entry.fileName,
							moduleIds,
							assetFiles: files
						});
					}
				}
			}
		};
	};

	return { plugin, workerPlugin };
}
