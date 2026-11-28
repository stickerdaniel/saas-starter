import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Run } from './run.ts';

/** Moves and deletes every tracked path the table sends elsewhere. */
export function movePaths(run: Run): void {
	const sources = new Set(run.flatPaths);
	for (const path of run.flatPaths) {
		const to = run.table.place(path)?.to;
		if (to === undefined || to === path) continue;
		if (to === null) {
			rmSync(join(run.checkout, path));
			continue;
		}
		if (sources.has(to) || existsSync(join(run.checkout, to))) {
			throw new Error(`${path} moves onto ${to}, which already exists`);
		}
		mkdirSync(dirname(join(run.checkout, to)), { recursive: true });
		renameSync(join(run.checkout, path), join(run.checkout, to));
	}
}

export interface SpecifierEdit {
	readonly file: string;
	readonly line: number;
	readonly from: string;
	readonly to: string;
}

const QUOTES = ["'", '"', '`'] as const;

function lineStart(text: string, line: number): number {
	let offset = 0;
	for (let current = 1; current < line; current += 1) {
		const next = text.indexOf('\n', offset);
		if (next === -1) return text.length;
		offset = next + 1;
	}
	return offset;
}

/**
 * Replaces each specifier on the line where its reference starts: the first quoted occurrence of
 * the specifier from that line is the reference, since an import's bindings and a call's callee
 * hold no string equal to it.
 */
export function editSpecifiers(checkout: string, edits: readonly SpecifierEdit[]): void {
	const byFile = Map.groupBy(edits, (edit) => edit.file);
	for (const [file, fileEdits] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
		const absolute = join(checkout, file);
		let text = readFileSync(absolute, 'utf8');
		const located = new Map<number, SpecifierEdit>();
		for (const edit of fileEdits) {
			const from = lineStart(text, edit.line);
			const found = QUOTES.flatMap((quote) => {
				const at = text.indexOf(`${quote}${edit.from}${quote}`, from);
				return at === -1 ? [] : [at + 1];
			});
			if (!found.length) throw new Error(`${file}:${edit.line} holds no quoted ${edit.from}`);
			located.set(Math.min(...found), edit);
		}
		for (const [at, edit] of [...located].sort(([a], [b]) => b - a)) {
			text = text.slice(0, at) + edit.to + text.slice(at + edit.from.length);
		}
		writeFileSync(absolute, text);
	}
}

/** Rewrites every specifier the mapper plans, in the file's new place. */
export function rewriteSpecifiers(run: Run): void {
	editSpecifiers(
		run.checkout,
		run.rewrites.map(({ file, line, specifier, next }) => ({
			file,
			line,
			from: specifier,
			to: next
		}))
	);
}
