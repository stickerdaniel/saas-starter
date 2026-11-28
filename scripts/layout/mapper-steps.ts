import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compareCodeUnits, StaleInput, type Run } from './run.ts';

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
	readonly literalOffset: number;
	readonly from: string;
	readonly to: string;
}

const QUOTES = new Set(["'", '"', '`']);

export function editedText(
	file: string,
	text: string,
	edits: readonly SpecifierEdit[]
): { text: string; problems: string[] } {
	const problems: string[] = [];
	let result = text;
	const ordered = [...edits].sort((a, b) => b.literalOffset - a.literalOffset);
	for (const [index, edit] of ordered.entries()) {
		const at = edit.literalOffset;
		const quote = text[at] ?? '';
		const fits =
			QUOTES.has(quote) &&
			text.startsWith(edit.from, at + 1) &&
			text[at + 1 + edit.from.length] === quote &&
			ordered[index - 1]?.literalOffset !== at;
		if (!fits) {
			problems.push(`${file}: no literal ${edit.from} at offset ${at}`);
			continue;
		}
		result = result.slice(0, at + 1) + edit.to + result.slice(at + 1 + edit.from.length);
	}
	return { text: result, problems };
}

/** Replaces each specifier at the literal the mapper read it from, and stops on one that is not there. */
export function editSpecifiers(checkout: string, edits: readonly SpecifierEdit[]): void {
	const byFile = Map.groupBy(edits, (edit) => edit.file);
	for (const [file, fileEdits] of [...byFile].sort(([a], [b]) => compareCodeUnits(a, b))) {
		const absolute = join(checkout, file);
		const { text, problems } = editedText(file, readFileSync(absolute, 'utf8'), fileEdits);
		if (problems.length) throw new StaleInput(problems.join('\n'));
		writeFileSync(absolute, text);
	}
}

/** Rewrites every specifier the mapper plans, in the file's new place. */
export function rewriteSpecifiers(run: Run): void {
	editSpecifiers(
		run.checkout,
		run.rewrites.map(({ file, literalOffset, specifier, next }) => ({
			file,
			literalOffset,
			from: specifier,
			to: next
		}))
	);
}
