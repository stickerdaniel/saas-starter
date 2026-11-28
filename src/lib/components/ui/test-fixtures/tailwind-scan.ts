import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compile, type Resolver } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

export const primitivesDirectory = resolve(import.meta.dirname, '..');

export interface StylesheetScan {
	files: Set<string>;
	candidates: Set<string>;
}

export async function scanStylesheet(
	entry: string,
	customCssResolver?: Resolver
): Promise<StylesheetScan> {
	const base = dirname(entry);
	const compiler = await compile(readFileSync(entry, 'utf8'), {
		base,
		from: entry,
		onDependency: () => {},
		customCssResolver
	});
	const root =
		compiler.root === 'none'
			? []
			: [{ ...(compiler.root ?? { base, pattern: '**/*' }), negated: false }];
	const scanner = new Scanner({ sources: [...root, ...compiler.sources] });
	const candidates = new Set(scanner.scan());
	return { files: new Set(scanner.files.map((file) => realpathSync(file))), candidates };
}

export function missingPrimitiveCandidates({ candidates }: StylesheetScan): string[] {
	const primitives = new Scanner({
		sources: [{ base: primitivesDirectory, pattern: '**/*', negated: false }]
	});
	return primitives.scan().filter((candidate) => !candidates.has(candidate));
}
