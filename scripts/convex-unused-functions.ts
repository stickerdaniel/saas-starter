import path from 'node:path';
import { identifiersIn, namespaceReferencesIn } from './convex-consumer-compat';

type SpecName = { group: string; name: string };
export type Source = { file: string; source: string };

const USAGE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.svelte']);
const IGNORED_GROUPS = ['tests', 'localDev'];
const MODULE_HANDOFF = /\b(?:api|internal)\.((?:[A-Za-z0-9_]+\.)*[A-Za-z0-9_]+)\b(?![\w$.(])/g;
const REFS_IMPORT =
	/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+['"][^'"]*_generated\/refs(?:\.[jt]s)?['"]/g;

export function countsAsUsage(file: string): boolean {
	return (
		USAGE_EXTENSIONS.has(path.extname(file)) &&
		!file.split('/').includes('_generated') &&
		!file.startsWith('e2e/') &&
		!file.endsWith('.test.ts')
	);
}

function escaped(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function refIdentifiersIn(source: string): string[] {
	return [...source.matchAll(REFS_IMPORT)].flatMap(([, binding]) =>
		[
			...source.matchAll(
				new RegExp(
					`(?<![\\w$.])${escaped(binding!)}\\.(?:public|internal)\\.((?:\\w+\\.)+\\w+)`,
					'g'
				)
			)
		].map(([, chain]) => {
			const parts = chain!.split('.');
			const name = parts.pop();
			return `${parts.join('/')}:${name}`;
		})
	);
}

export function unusedFunctions(
	functions: readonly SpecName[],
	sources: readonly Source[]
): string[] {
	const used = new Set<string>();
	const prefixes: string[] = [];
	for (const { file, source } of sources) {
		if (!countsAsUsage(file)) continue;
		for (const { identifier } of identifiersIn(source, file)) used.add(identifier);
		for (const identifier of refIdentifiersIn(source)) used.add(identifier);
		for (const { prefix } of namespaceReferencesIn(source, file)) prefixes.push(`${prefix}/`);
		for (const [, chain] of source.matchAll(MODULE_HANDOFF)) {
			prefixes.push(`${chain!.replaceAll('.', '/')}/`);
		}
	}
	const below = (group: string, prefixes: readonly string[]) =>
		prefixes.some((prefix) => `${group}/`.startsWith(prefix));
	return functions
		.filter(
			({ group }) =>
				!below(
					group,
					IGNORED_GROUPS.map((ignored) => `${ignored}/`)
				)
		)
		.filter(({ group }) => !below(group, prefixes))
		.map(({ group, name }) => `${group}:${name}`)
		.filter((identifier) => !used.has(identifier))
		.sort();
}
