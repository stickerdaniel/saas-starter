import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export interface CssPackageInput {
	directive: '@import' | '@plugin';
	specifier: string;
	packageName: string;
	file: string;
}

const DIRECTIVE = /@(import|plugin)\s+(['"])([^'"\n]+)\2/g;

/** The package a bare CSS specifier names, or null for relative, absolute, or URL inputs. */
export function cssPackageName(specifier: string): string | null {
	if (/^(?:[./#~]|[a-z][a-z0-9+.-]*:)/i.test(specifier)) return null;
	const segments = specifier.split('/');
	if (specifier.startsWith('@'))
		return segments.length >= 2 ? segments.slice(0, 2).join('/') : null;
	return segments[0] || null;
}

function cssFiles(directory: string): string[] {
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) return cssFiles(file);
		return entry.isFile() && entry.name.endsWith('.css') ? [file] : [];
	});
}

/**
 * Package-valued `@import` and `@plugin` directives in authored CSS. Vite's
 * module graph does not report packages that Tailwind inlines from CSS, so these
 * are matched against the configured extraPackages instead. `@source` only
 * steers class scanning and ships no package code, so it is ignored.
 */
export function findCssPackageInputs(
	root: string,
	directories: readonly string[]
): CssPackageInput[] {
	const inputs: CssPackageInput[] = [];
	for (const directory of directories) {
		for (const file of cssFiles(path.resolve(root, directory)).sort()) {
			const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
			for (const match of source.matchAll(DIRECTIVE)) {
				const specifier = match[3]!;
				const packageName = cssPackageName(specifier);
				if (!packageName) continue;
				inputs.push({
					directive: `@${match[1]}` as CssPackageInput['directive'],
					specifier,
					packageName,
					file: path.relative(root, file).replaceAll('\\', '/')
				});
			}
		}
	}
	return inputs;
}

export function uncoveredCssInputProblems(
	inputs: readonly CssPackageInput[],
	extraPackages: ReadonlyArray<{ name: string }>,
	configFileName: string
): string[] {
	const covered = new Set(extraPackages.map((entry) => entry.name));
	return inputs
		.filter((input) => !covered.has(input.packageName))
		.map(
			(input) =>
				`${input.packageName} [styles]\n  ${input.file} has \`${input.directive} '${input.specifier}'\`, which ships package code through CSS that the bundle graph cannot see.\n  Fix: add { "name": "${input.packageName}", "components": ["styles"] } to extraPackages in ${configFileName}.`
		);
}

/**
 * Resolve Kit's service worker entry with the forms Kit accepts: an explicit
 * file, an extensionless stem with .js or .ts, or a directory with index.js or
 * index.ts. Returns the existing entry or null.
 */
export function findServiceWorkerEntry(entry: string): string | null {
	if (existsSync(entry)) {
		if (statSync(entry).isFile()) return entry;
		for (const index of ['index.js', 'index.ts']) {
			const candidate = path.join(entry, index);
			if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
		}
	}
	const directory = path.dirname(entry);
	const base = path.basename(entry);
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch {
		return null;
	}
	const found = names.find(
		(name) =>
			name.replace(/\.(js|ts)$/, '') === base && statSync(path.join(directory, name)).isFile()
	);
	return found ? path.join(directory, found) : null;
}
