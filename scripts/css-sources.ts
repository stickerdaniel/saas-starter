import { dirname, resolve } from 'node:path';
import { Scanner } from '@tailwindcss/oxide';
import postcss from 'postcss';

/** Tailwind source globs are relative to their stylesheet, not the project root. */
export function emptyCssSources(file: string, text: string): string[] {
	const failures: string[] = [];
	postcss.parse(text, { from: file }).walkAtRules('source', (rule) => {
		const literal = /^(['"])(.+)\1$/.exec(rule.params);
		if (!literal) return;
		const scanner = new Scanner({
			sources: [{ base: dirname(resolve(file)), pattern: literal[2]!, negated: false }]
		});
		if (scanner.files.length > 0) return;
		failures.push(
			`${file}:${rule.source?.start?.line ?? 1}: @source matches no files; resolve its path relative to this stylesheet so Tailwind includes dependency styles.`
		);
	});
	return failures;
}
