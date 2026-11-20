import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export const MODULE_GRAPH_FILE = 'client-module-graph.json';

export interface GraphChunk {
	fileName: string;
	facadeModuleId: string | null;
	imports: string[];
	dynamicImports: string[];
	modules: string[];
}

export interface ModuleGraph {
	unsetPublicEnv: string[];
	chunks: GraphChunk[];
}

export function moduleGraph(options: {
	outFile: string;
	root: string;
	publicEnv: () => Record<string, string | undefined>;
}): Plugin {
	const relative = (id: string) => path.relative(options.root, id).split(path.sep).join('/');
	return {
		name: 'client-module-graph',
		apply: 'build',
		writeBundle(_options, bundle) {
			if (this.environment.name !== 'client') return;
			const chunks = Object.values(bundle).flatMap((output): GraphChunk[] =>
				output.type === 'chunk'
					? [
							{
								fileName: output.fileName,
								facadeModuleId: output.facadeModuleId && relative(output.facadeModuleId),
								imports: output.imports,
								dynamicImports: output.dynamicImports,
								modules: Object.keys(output.modules).map(relative)
							}
						]
					: []
			);
			const unsetPublicEnv = Object.entries(options.publicEnv())
				.filter(([, value]) => !value)
				.map(([name]) => name)
				.sort();
			const graph: ModuleGraph = { unsetPublicEnv, chunks };
			fs.mkdirSync(path.dirname(options.outFile), { recursive: true });
			fs.writeFileSync(options.outFile, `${JSON.stringify(graph)}\n`);
		}
	};
}
