/**
 * T0 spike: per-route client JS from a build's module graph.
 *
 *   T0_GRAPH=/tmp/graph.json WORKERS_CI=1 bun run build
 *   bun scripts/spike/route-closures.ts /tmp/graph.json > closures.json
 *
 * A route's initial closure is the static-import closure of Kit's two client
 * entries (`manifest.client.start` and `.app`) plus the route's layout and leaf nodes (`manifest.routes[].page`).
 * Lazy chunks are the dynamic imports reachable from that closure, other
 * routes' nodes excluded, with their own static closure. Sizes are gzip -9 of
 * the emitted files; provenance is each chunk's member module ids.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

interface Chunk {
	fileName: string;
	isEntry: boolean;
	isDynamicEntry: boolean;
	facadeModuleId: string | null;
	imports: string[];
	dynamicImports: string[];
	modules: Record<string, number>;
}

const [graphFile] = process.argv.slice(2);
if (!graphFile) throw new Error('usage: route-closures.ts <graph.json>');
const { chunks } = JSON.parse(fs.readFileSync(graphFile, 'utf8')) as { chunks: Chunk[] };
const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
const clientDir = path.resolve('.svelte-kit/output/client');
const gzip = new Map<string, number>();
const gzipSize = (file: string) => {
	let size = gzip.get(file);
	if (size === undefined) {
		size = zlib.gzipSync(fs.readFileSync(path.join(clientDir, file)), { level: 9 }).length;
		gzip.set(file, size);
	}
	return size;
};

const { manifest } = (await import(path.resolve('.svelte-kit/output/server/manifest.js'))) as {
	manifest: {
		client: { start: string; app: string };
		routes: Array<{
			id: string;
			page: { layouts: Array<number | undefined>; leaf: number } | null;
		}>;
	};
};

const nodeChunk = new Map<number, string>();
for (const chunk of chunks) {
	const match = chunk.facadeModuleId?.match(/client-optimized\/nodes\/(\d+)\.js$/);
	if (match) nodeChunk.set(Number(match[1]), chunk.fileName);
}
const nodeFiles = new Set(nodeChunk.values());
const entries = [manifest.client.start, manifest.client.app];

function staticClosure(roots: string[], into = new Set<string>()) {
	const stack = [...roots];
	while (stack.length) {
		const file = stack.pop()!;
		if (into.has(file)) continue;
		into.add(file);
		stack.push(...(byFile.get(file)?.imports ?? []));
	}
	return into;
}

const isEffect = (id: string) => id.includes('/node_modules/effect/');
const isSupport = (id: string) => id.includes('/src/lib/components/customer-support/');
const provenance = (files: Iterable<string>) => {
	let effectModules = 0;
	let effectRenderedBytes = 0;
	const effectChunks = new Set<string>();
	const supportModules = new Set<string>();
	for (const file of files) {
		for (const [id, size] of Object.entries(byFile.get(file)?.modules ?? {})) {
			if (isEffect(id)) {
				effectModules++;
				effectRenderedBytes += size;
				effectChunks.add(file);
			}
			if (isSupport(id)) supportModules.add(id.slice(id.indexOf('/src/') + 1));
		}
	}
	return {
		effectModules,
		effectRenderedBytes,
		effectChunks: [...effectChunks],
		supportModules: [...supportModules]
	};
};
const sum = (files: Iterable<string>) =>
	[...files].reduce((total, file) => total + gzipSize(file), 0);

const pages = manifest.routes.filter((route) => route.page);
const initialByRoute = new Map(
	pages.map((route) => {
		const nodes = [...route.page!.layouts, route.page!.leaf].filter(
			(n): n is number => n !== undefined
		);
		return [route.id, staticClosure([...entries, ...nodes.map((n) => nodeChunk.get(n)!)])];
	})
);
const routesUsing = new Map<string, number>();
for (const files of initialByRoute.values()) {
	for (const file of files) routesUsing.set(file, (routesUsing.get(file) ?? 0) + 1);
}

const routes = pages.map((route) => {
	const initial = initialByRoute.get(route.id)!;
	const lazyRoots = [...initial]
		.flatMap((file) => byFile.get(file)?.dynamicImports ?? [])
		.filter((file) => !nodeFiles.has(file) && !initial.has(file));
	const lazy = new Set([...staticClosure(lazyRoots)].filter((file) => !initial.has(file)));
	const unique = [...initial].filter((file) => routesUsing.get(file) === 1);
	return {
		route: route.id,
		initialGzip: sum(initial),
		initialChunks: initial.size,
		uniqueGzip: sum(unique),
		sharedGzip: sum(initial) - sum(unique),
		lazyGzip: sum(lazy),
		lazyChunks: lazy.size,
		initial: provenance(initial),
		lazy: provenance(lazy)
	};
});

console.log(JSON.stringify({ graphFile, entries, routes }, null, 2));
