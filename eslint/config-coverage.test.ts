// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * What `no-literal-control-char` can actually see.
 *
 * The rule replaced a scan in `scripts/static-checks.ts` whose route required a
 * `src/` prefix, so it reached neither `scripts/` nor the config files nor itself.
 * That claim is the whole reason the rule lives in ESLint, and nothing enforced it:
 * a `files` glob, an `ignores` entry, or a later config block can take a file back
 * out of reach without a single test failing.
 *
 * A file can also be out of reach for a reason no config expresses. Convex codegen
 * and varlock write `/* eslint-disable *\/` into their output, which switches every
 * rule off from inside the file, so those paths stay in the global ignores and are
 * asserted here as unreachable rather than quietly assumed to be covered.
 */
const eslint = new ESLint();

/** `calculateConfigForFile` normalizes severity to a number, where 2 is `error`. */
async function ruleSeverity(file: string): Promise<unknown> {
	const config = await eslint.calculateConfigForFile(file);
	return config.rules?.['local/no-literal-control-char']?.[0];
}

describe('no-literal-control-char coverage', () => {
	it.each([
		['a source module', 'src/lib/utils/index.ts'],
		['a Svelte component', 'src/routes/+layout.svelte'],
		['a build script outside src/', 'scripts/static-checks.ts'],
		['the ESLint config itself', 'eslint.config.js'],
		['the rule implementation', 'eslint/rules/no-literal-control-char.js'],
		['the generated env types', 'src/env.d.ts']
	])('reaches %s', async (_label, file) => {
		expect(await ruleSeverity(file)).toBe(2);
	});

	// Not a gap this config can close. Both generators emit a file-level disable, so
	// un-ignoring these paths would buy nothing and add unused-directive warnings.
	it.each([
		['Convex codegen output', 'src/lib/convex/_generated/api.js'],
		['the varlock Convex env types', 'src/lib/convex/convex-env.d.ts']
	])(
		'leaves %s ignored, because its generator disables ESLint inside the file',
		async (_label, file) => {
			expect(await eslint.isPathIgnored(file)).toBe(true);
		}
	);
});
