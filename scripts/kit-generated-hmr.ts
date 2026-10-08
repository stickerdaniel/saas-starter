import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

/**
 * Drops dev HMR for SvelteKit generated files whose content did not change.
 *
 * Kit caches written content in memory, so every new dev process rewrites all of
 * `.svelte-kit/generated` once at startup, and the watcher reports it. After a
 * production build the first dev render then 500s: `setContext` runs against a
 * second copy of Svelte's server runtime that has no component context
 * (`lifecycle_outside_component`). The same first request passes once those
 * reports no longer reload the SSR runner. A generated file whose content really
 * changed, such as a route added during dev, still reloads.
 *
 * Each environment remembers the source it last loaded for a generated file and
 * keeps its graph when the file on disk still has that source. Real changes,
 * such as a route added during dev, still reload.
 */
export function kitGeneratedHmr(): Plugin {
	let generatedDir = '';
	const loaded = new Map<string, Map<string, string>>();

	const generatedFile = (id: string) => {
		const file = id.split('?', 1)[0]!;
		return file.startsWith(generatedDir) ? file : undefined;
	};

	return {
		name: 'kit-generated-hmr',
		apply: 'serve',
		configResolved(config) {
			// Module ids and watcher paths use forward slashes on every platform.
			generatedDir = `${config.root}/.svelte-kit/generated/`;
		},
		load: {
			order: 'pre',
			async handler(id) {
				const file = generatedFile(id);
				if (!file) return;
				const sources = loaded.get(this.environment.name) ?? new Map<string, string>();
				loaded.set(this.environment.name, sources);
				sources.set(file, await readFile(file, 'utf8'));
			}
		},
		async hotUpdate({ type, file, read }) {
			if (type !== 'update' || !generatedFile(file)) return;
			const previous = loaded.get(this.environment.name)?.get(file);
			if (previous !== undefined && (await read()) === previous) return [];
		}
	};
}
