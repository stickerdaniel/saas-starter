import { existsSync, globSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { assert, describe, expect, it } from 'vitest';

const DEPENDENCY_SECTIONS = [
	'dependencies',
	'devDependencies',
	'optionalDependencies',
	'peerDependencies'
] as const;

type Manifest = Partial<Record<(typeof DEPENDENCY_SECTIONS)[number], Record<string, string>>> & {
	workspaces?: string[] | { packages?: string[] };
	patchedDependencies?: Record<string, string>;
};

function manifestIn(directory: string): Manifest {
	return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
}

const root = join(import.meta.dirname, '..');
const { patchedDependencies = {}, workspaces } = manifestIn(root);
const manifests = [
	'',
	...(Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? [])).flatMap((pattern) =>
		globSync(pattern, { cwd: root })
	)
]
	.filter((member) => existsSync(join(root, member, 'package.json')))
	.map((member) => ({
		manifestFile: join(member, 'package.json'),
		directory: join(root, member),
		manifest: manifestIn(join(root, member))
	}));

function installedCopy(directory: string, name: string): string | undefined {
	return (createRequire(join(directory, 'package.json')).resolve.paths(name) ?? [])
		.map((lookup) => join(lookup, name))
		.find((candidate) => existsSync(join(candidate, 'package.json')));
}

const TRAILING = /[ \t\r]+$/;

interface Hunk {
	file: string;
	start: number;
	count: number;
	lines: Array<{ text: string; added: boolean }>;
}

function hunks(patch: string): Hunk[] {
	const found: Hunk[] = [];
	let file: string | undefined;
	let hunk: Hunk | undefined;
	for (const line of patch.split('\n')) {
		const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (line.startsWith('diff --git ')) {
			file = undefined;
			hunk = undefined;
		} else if (header && file !== undefined) {
			hunk = { file, start: Number(header[1]), count: Number(header[2] ?? 1), lines: [] };
			found.push(hunk);
		} else if (hunk === undefined) {
			file = /^\+\+\+ b\/(.+)$/.exec(line)?.[1] ?? file;
		} else if (hunk.lines.length < hunk.count && !/^[-\\]/.test(line)) {
			hunk.lines.push({ text: line.slice(1), added: line.startsWith('+') });
		}
	}
	return found;
}

function installedLines(copy: string, file: string): string[] {
	const lines = readFileSync(join(copy, file), 'utf8').split('\n');
	return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

describe('dependency patches', () => {
	it.each(Object.entries(patchedDependencies))(
		'%s has every hunk at the line its header names and nowhere else, where Bun 1.4.3 applies it',
		(dependency, path) => {
			const name = dependency.slice(0, dependency.lastIndexOf('@'));
			const patched = hunks(readFileSync(join(root, path), 'utf8'));
			expect(patched).not.toEqual([]);
			const declaring = manifests.filter(({ manifest }) =>
				DEPENDENCY_SECTIONS.some((section) => manifest[section]?.[name] !== undefined)
			);
			expect(declaring, `no manifest declares ${name}`).not.toEqual([]);
			for (const { manifestFile, directory } of declaring) {
				const copy = installedCopy(directory, name);
				assert(
					copy,
					`${manifestFile} declares ${name}, which resolves to no installed copy from there`
				);
				for (const { file, start, lines } of patched) {
					expect(lines, `${file}, hunk of line ${start} has no context`).not.toEqual([]);
					const installed = installedLines(copy, file);
					const found = installed.flatMap((_, index) =>
						lines.every(({ text, added }, offset) => {
							const line = installed[index + offset];
							return added
								? line === text
								: line?.replace(TRAILING, '') === text.replace(TRAILING, '');
						})
							? [index + 1]
							: []
					);
					expect(found, `${relative(root, copy)}, ${file}, hunk of line ${start}`).toEqual([start]);
				}
			}
		}
	);
});
