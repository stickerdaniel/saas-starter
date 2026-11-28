/**
 * Files whose content changes with the layout in a way no specifier rewrite reaches. Each entry
 * records the SHA-256 of the flat file at the commit it was written against; when `main` changes
 * that file, the generator stops and names it, so the entry is rewritten against the new text.
 */
import { createHash } from 'node:crypto';
import { editedText } from './mapper-steps.ts';
import { readText, StaleInput, writeText, type Run } from './run.ts';

export type Edit = readonly [before: string, after: string];

export interface Replacement {
	/** The flat path whose content the entry was written against. */
	readonly from: string;
	readonly sha256: string;
	/** The whole new content, or literal edits of the moved file, each matching once. */
	readonly content: string | readonly Edit[];
}

const SKILLS_TSCONFIG = `{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"declaration": false,
		"declarationMap": false,
		"noEmit": true,
		"types": ["node", "vitest/globals"]
	},
	"include": ["*/scripts/**/*.ts"]
}
`;

const APP_TSCONFIG = `{
	// SvelteKit writes this base config (paths, generated types, required compiler options)
	// during sync. It allows explicit .ts specifiers rather than rewriting them, which this
	// noEmit, Vite-built app relies on. The shared options of every workspace come first.
	"extends": ["../../tsconfig.base.json", "$app/tsconfig"],
	"files": ["scripts/check-table-scroll.ts", "scripts/check-streamdown-overlay.ts"],
	"compilerOptions": {
		"sourceMap": true,
		"declaration": true,
		"declarationMap": true
	},
	// The base config sets no include/exclude, so these replace the lists SvelteKit 2
	// generated: the app sources and the Vite config.
	"include": ["src/**/*.js", "src/**/*.ts", "src/**/*.svelte", "vite.config.ts"],
	"exclude": ["node_modules/**", "references/**", "src/service-worker"]
}
`;

const ROOT_TOOLING_CONFIG = `import { defineConfig, mergeConfig } from 'vitest/config';
import {
	sharedTestSettings,
	toolingTestSettings
} from './packages/tooling/src/vitest-settings.ts';

export default defineConfig({
	// Tooling tests must not depend on SvelteKit's generated tsconfig or application env.
	tsconfig: './tsconfig.tooling.json',
	// Every workspace runs its own tests; the root owns the files outside them.
	test: mergeConfig(mergeConfig(sharedTestSettings, toolingTestSettings), {
		exclude: ['apps/**', 'packages/**']
	})
});
`;

const CREATOR_TSCONFIG = `{
	"compilerOptions": {
		"target": "ES2023",
		"module": "NodeNext",
		"moduleResolution": "NodeNext",
		"strict": true,
		"noEmit": true,
		"allowImportingTsExtensions": true,
		"verbatimModuleSyntax": true,
		"skipLibCheck": true,
		"types": ["node", "vitest/globals"]
	},
	"include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"]
}
`;

export const REPLACEMENTS: readonly Replacement[] = [
	{
		from: 'src/routes/layout.css',
		sha256: 'b16a4464161fa0911cdc0f5ab2a5b29e6074e1dc4dcd86237aa7fac4148ab58f',
		content: [
			[
				"@import '../lib/components/ui/tokens.css';",
				"@import '@repo/ui/src/components/ui/tokens.css';"
			]
		]
	},
	{
		from: 'tsconfig.json',
		sha256: 'b9e84d2dfc23495c0dc9a5cd64e15803e209696cd27ccb621c233e53d5a6413a',
		content: APP_TSCONFIG
	},
	{
		from: 'vitest.tooling.config.ts',
		sha256: '4254fe08c4d3b0b8503ebcfc55b0155faf8839668f04ff30cbdde5a4a1ed31e4',
		content: ROOT_TOOLING_CONFIG
	},
	{
		from: 'packages/create-saas-starter/tsconfig.json',
		sha256: 'af8853a90d7130497609b0805f6088617a86e6090214c74bceb96e9e08809368',
		content: CREATOR_TSCONFIG
	},
	{
		from: '.agents/skills/tsconfig.json',
		sha256: 'c4ce42e60b5e20e4fc44123ecec4fe042204e0ba795f1bf1369dd9ae7cc66d9c',
		content: SKILLS_TSCONFIG
	},
	{
		from: '.env-convex.schema',
		sha256: 'e25fe0131aadc7c6b66d8fe34ab579b9ab61303a2f41193fc11bff7305f7701a',
		content: [
			[
				'@generateTsTypes(path=src/lib/confect/convex-env.d.ts)',
				'@generateTsTypes(path=confect/convex-env.d.ts)'
			]
		]
	},
	{
		from: 'src/lib/i18n/static-translations.generated.ts',
		sha256: 'a453aa74ce967650b5ed5b85d8bb6115cba4ab8a514cb0e8aa941f20682495ab',
		content: (['en', 'de', 'es', 'fr'] as const).map((code) => [
			`import ${code} from './${code}.json';`,
			`import ${code} from './${code}.json' with { type: 'json' };`
		])
	},
	{
		from: 'scripts/generate-authored-content.ts',
		sha256: 'd3da129927eb315f0d84e2c8729a3fa45fe41c7d034d513a083e3bc753b1c6d2',
		content: [
			["'src/lib/confect/support/instructions.txt'", "'confect/support/instructions.txt'"],
			[
				"'src/lib/confect/support/instructions.generated.ts'",
				"'confect/support/instructions.generated.ts'"
			],
			[
				"'src/lib/convex/support/instructions.generated.ts'",
				"'convex/support/instructions.generated.ts'"
			],
			["'src/lib/convex/convex-env.d.ts'", "'convex/convex-env.d.ts'"]
		]
	},
	{
		from: 'scripts/build-emails.ts',
		sha256: 'eb5d8202dd97d3c584d5c4bd1f0f3f3ca0cbd84e13cdc9e0803b3927609585cf',
		content: [
			["'../src/lib/emails/generated'", "'../src/generated'"],
			["'../src/lib/convex/emails/_generated'", "'../../backend/convex/emails/_generated'"],
			["'/src/lib/emails/templates'", "'/src/templates'"],
			["'/src/lib/emails/renderer.ts'", "'/src/renderer.ts'"]
		]
	}
];

export function sha256(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

function editProblem(path: string, text: string, before: string): string | undefined {
	const first = text.indexOf(before);
	if (first !== -1 && text.indexOf(before, first + 1) === -1) return undefined;
	return `${path} holds ${before} ${first === -1 ? 'nowhere' : 'more than once'}, not once`;
}

export function applyEdits(
	path: string,
	text: string,
	edits: readonly Edit[]
): { text: string; problems: string[] } {
	const problems: string[] = [];
	const result = edits.reduce((current, [before, after]) => {
		const problem = editProblem(path, current, before);
		if (problem) {
			problems.push(problem);
			return current;
		}
		return current.replace(before, () => after);
	}, text);
	return { text: result, problems };
}

type Projection = Pick<Run, 'flatFile' | 'table' | 'rewrites'>;

function projectedText(run: Projection, from: string, to: string): string {
	const rewrites = run.rewrites
		.filter(({ file }) => file === to)
		.map(({ literalOffset, specifier, next }) => ({
			file: to,
			literalOffset,
			from: specifier,
			to: next
		}));
	return editedText(to, run.flatFile(from), rewrites).text;
}

/** The flat files that changed since the replacement for each was written. */
export function staleReplacements(
	flatFile: (path: string) => string,
	replacements: readonly Replacement[] = REPLACEMENTS
): string[] {
	return replacements
		.filter(({ from, sha256: recorded }) => sha256(flatFile(from)) !== recorded)
		.map(
			({ from }) =>
				`${from} changed since its replacement in scripts/layout/replacements.ts was written; rewrite the replacement against the new file and record its SHA-256`
		);
}

export function replacementProblems(
	run: Projection,
	replacements: readonly Replacement[] = REPLACEMENTS
): string[] {
	const stale = staleReplacements(run.flatFile, replacements);
	if (stale.length) return stale;
	return replacements.flatMap(({ from, content }) => {
		const to = run.table.place(from)?.to;
		if (!to) return [`The move table deletes ${from}, which a replacement names`];
		if (typeof content === 'string') return [];
		return applyEdits(to, projectedText(run, from, to), content).problems;
	});
}

export function verifyReplacements(run: Run): void {
	const problems = replacementProblems(run, run.inputs.replacements);
	if (problems.length) throw new StaleInput(problems.join('\n'));
}

/** Writes each replacement at the moved place of its flat file. */
export function writeReplacements(run: Run): void {
	for (const { from, content } of run.inputs.replacements) {
		const to = run.table.place(from)?.to;
		if (!to) throw new StaleInput(`The move table deletes ${from}, which a replacement names`);
		if (typeof content === 'string') {
			writeText(run, to, content);
			continue;
		}
		const { text, problems } = applyEdits(to, readText(run, to), content);
		if (problems.length) throw new StaleInput(problems.join('\n'));
		writeText(run, to, text);
	}
}
