import fs from 'node:fs';
import type { Plugin } from 'vite';

/**
 * T0 spike: writes the client bundle's chunk graph with module provenance
 * (each chunk's imports, dynamic imports and member modules with rendered
 * sizes) to the file named by `T0_GRAPH`. `scripts/spike/route-closures.ts`
 * reads it.
 */
export function moduleGraph(outFile: string): Plugin {
	return {
		name: 't0-module-graph',
		apply: 'build',
		generateBundle(_options, bundle) {
			if (this.environment.name !== 'client') return;
			const chunks = Object.values(bundle).flatMap((output) =>
				output.type === 'chunk'
					? [
							{
								fileName: output.fileName,
								isEntry: output.isEntry,
								isDynamicEntry: output.isDynamicEntry,
								facadeModuleId: output.facadeModuleId,
								imports: output.imports,
								dynamicImports: output.dynamicImports,
								modules: Object.fromEntries(
									Object.entries(output.modules).map(([id, info]) => [id, info.renderedLength])
								)
							}
						]
					: []
			);
			fs.writeFileSync(outFile, JSON.stringify({ chunks }, null, 1));
		}
	};
}
