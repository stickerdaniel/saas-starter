import { globSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postcss from 'postcss';

/** Tailwind source globs are relative to their stylesheet, not the project root. */
export function emptyCssSources(file: string, text: string): string[] {
	const failures: string[] = [];
	postcss.parse(text, { from: file }).walkAtRules('source', (rule) => {
		const literal = /^(['"])(.+)\1$/.exec(rule.params);
		if (!literal) return;
		const matches = globSync(literal[2]!, { cwd: dirname(file) });
		const hasFiles = matches.some((match) => {
			const target = resolve(dirname(file), match);
			if (statSync(target).isFile()) return true;
			return globSync('**/*', { cwd: target }).some((child) =>
				statSync(resolve(target, child)).isFile()
			);
		});
		if (hasFiles) return;
		failures.push(
			`${file}:${rule.source?.start?.line ?? 1}: @source matches no files; resolve its path relative to this stylesheet so Tailwind includes dependency styles.`
		);
	});
	return failures;
}
