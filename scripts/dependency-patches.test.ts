import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const { patchedDependencies }: { patchedDependencies: Record<string, string> } = JSON.parse(
	readFileSync(join(root, 'package.json'), 'utf8')
);

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

function installedLines(name: string, file: string): string[] {
	const lines = readFileSync(join(root, 'node_modules', name, file), 'utf8').split('\n');
	return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

describe('dependency patches', () => {
	it.each(Object.entries(patchedDependencies))(
		'%s has every hunk at the line its header names and nowhere else, where Bun 1.4.3 applies it',
		(dependency, path) => {
			const name = dependency.slice(0, dependency.lastIndexOf('@'));
			const patched = hunks(readFileSync(join(root, path), 'utf8'));
			expect(patched).not.toEqual([]);
			for (const { file, start, lines } of patched) {
				expect(lines, `${file}, hunk of line ${start} has no context`).not.toEqual([]);
				const installed = installedLines(name, file);
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
				expect(found, `${file}, hunk of line ${start}`).toEqual([start]);
			}
		}
	);
});
