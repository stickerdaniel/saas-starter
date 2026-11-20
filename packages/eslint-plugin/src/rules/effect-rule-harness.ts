import path from 'node:path';
import { Linter, type Rule } from 'eslint';
import { parser } from 'typescript-eslint';

const cwd = path.resolve('/repo');

export interface ScopeOptions {
	files?: string[];
	allow?: string[];
}

export function lintRule(
	rule: Rule.RuleModule,
	code: string,
	{ file = 'src/lib/effect/example.ts', options = { files: ['src/**'] } as ScopeOptions } = {}
) {
	const messages = new Linter({ cwd }).verify(
		code,
		{
			files: ['**/*.ts'],
			languageOptions: { parser },
			plugins: { local: { rules: { rule } } },
			rules: { 'local/rule': ['error', options] }
		},
		{ filename: path.join(cwd, file) }
	);
	const fatal = messages.find((message) => message.fatal);
	if (fatal) throw new Error(`Fixture does not parse: ${fatal.message}`);
	return messages.map(({ messageId, line }) => ({ messageId, line }));
}
