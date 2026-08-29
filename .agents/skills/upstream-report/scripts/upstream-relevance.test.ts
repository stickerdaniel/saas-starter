import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changedRegionLines, classifyVerdict, regionOverlap } from './upstream-relevance';

describe('changedRegionLines', () => {
	it('keeps removed and context lines, drops additions', () => {
		const diff = [
			'diff --git a/x.ts b/x.ts',
			'--- a/x.ts',
			'+++ b/x.ts',
			'@@ -1,4 +1,4 @@',
			' const before = 1;',
			'-const wrong = 2;',
			'+const right = 3;',
			' const after = 4;'
		].join('\n');
		expect(changedRegionLines(diff)).toEqual([
			{ removed: ['const wrong = 2;'], context: ['const before = 1;', 'const after = 4;'] }
		]);
	});

	it('ignores the file headers that look like removals and additions', () => {
		// `--- a/x` and `+++ b/x` sit before the first @@ and are excluded by
		// position, not by prefix. See the next test for why that matters.
		const diff = ['--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n');
		expect(changedRegionLines(diff)).toEqual([{ removed: ['a'], context: [] }]);
	});

	it('keeps a removed line whose own content starts with two dashes', () => {
		// Removing `--flag` reaches the parser as `---flag`. Filtering that as a
		// file header discards the only evidence a one-line change has, and the
		// file then scores zero overlap and is silently dismissed.
		const diff = ['@@ -1 +1 @@', '---flag', '+--other'].join('\n');
		expect(changedRegionLines(diff)).toEqual([{ removed: ['--flag'], context: [] }]);
	});

	it('reads every hunk of a multi-hunk diff', () => {
		const diff = [
			'@@ -1,2 +1,2 @@',
			' one',
			'-two',
			'+TWO',
			'@@ -20,2 +20,2 @@',
			' twenty',
			'-twentyone'
		].join('\n');
		expect(changedRegionLines(diff)).toEqual([
			{ removed: ['two'], context: ['one'] },
			{ removed: ['twentyone'], context: ['twenty'] }
		]);
	});
});

describe('regionOverlap', () => {
	const upstream = ['export function greet(name) {', '\treturn `hello ${name}`;', '}'].join('\n');

	it('scores an edit to untouched template code as fully overlapping', () => {
		expect(
			regionOverlap(
				[{ removed: ['export function greet(name) {', '\treturn `hello ${name}`;'], context: [] }],
				upstream
			)
		).toBe(1);
	});

	it('scores an edit to fork-only code inside a shared file as zero', () => {
		expect(
			regionOverlap(
				[{ removed: ['const forkOnlyThing = buildDaphneThing();'], context: [] }],
				upstream
			)
		).toBe(0);
	});

	it('ignores indentation, so reformatted code still matches', () => {
		expect(
			regionOverlap([{ removed: ['            return `hello ${name}`;'], context: [] }], upstream)
		).toBe(1);
	});

	it('does not let braces and blank lines inflate the score', () => {
		// A region of pure punctuation matches any file ever written. Counting it
		// would mark every fork-only edit as upstream-relevant. Dropping it leaves
		// nothing to measure, which is "unmeasured" and gets a glance. It is not a
		// confident 100%, and not a confident 0 either.
		expect(regionOverlap([{ removed: ['}', '', '  '], context: [] }], upstream)).toBeNull();
	});

	it('still scores a region that mixes punctuation with real lines', () => {
		expect(regionOverlap([{ removed: ['}', 'const forkOnly = 1;'], context: [] }], upstream)).toBe(
			0
		);
		expect(
			regionOverlap([{ removed: ['}', '\treturn `hello ${name}`;'], context: [] }], upstream)
		).toBe(1);
	});

	it('counts a repeated line only as often as upstream actually has it', () => {
		const twice = 'value = 1;\nvalue = 1;\nother = 2;';
		expect(
			regionOverlap([{ removed: ['value = 1;', 'value = 1;', 'value = 1;'], context: [] }], twice)
		).toBeCloseTo(2 / 3);
	});

	it('does not clone the complete upstream tally for each hunk', () => {
		const source = readFileSync(resolve(import.meta.dirname, 'upstream-relevance.ts'), 'utf8');
		const start = source.indexOf('function hunkOverlap(');
		const end = source.indexOf('export function classifyVerdict(', start);
		const implementation = source.slice(start, end);
		expect(implementation).toContain('const used = new Map<string, number>();');
		expect(implementation).not.toContain('new Map(upstreamLines)');
	});

	it('reports "not measured" for an empty region, never zero', () => {
		// Zero means "measured, and none of it is upstream", a definitive
		// negative. Nothing to measure is a different answer and must not
		// collapse into it, or a binary file reads as proof of irrelevance.
		expect(regionOverlap([], upstream)).toBeNull();
		expect(regionOverlap([{ removed: [], context: [] }], upstream)).toBeNull();
		expect(regionOverlap([{ removed: ['', ' '], context: [] }], upstream)).toBeNull();
	});
});

describe('classifyVerdict', () => {
	it('keeps an absent path visible when ownership is not proven', () => {
		expect(
			classifyVerdict({
				path: 'src/lib/daphne/voice.ts',
				existsUpstream: false,
				baseMatchesUpstream: false
			})
		).toEqual({
			path: 'src/lib/daphne/voice.ts',
			relevance: 'unmeasured',
			note: 'no upstream path, but fork ownership is not proven',
			report: true
		});
	});

	it('always reports an edit to a file the fork had never touched', () => {
		// The strongest signal in the whole detector: pristine template code that
		// needed fixing here needs fixing in every other fork too.
		const v = classifyVerdict({
			path: 'src/lib/emails/components/layout/EmailFooter.svelte',
			existsUpstream: true,
			baseMatchesUpstream: true
		});
		expect(v.relevance).toBe('pristine');
		expect(v.report).toBe(true);
	});

	it('reports every shared file that changed, whatever its overlap', () => {
		// The overlap ranks; it does not gate. Line matching cannot tell a
		// fork-only line from a template line this fork had renamed, so any
		// threshold drops real findings. Measured: a 20% gate hid the one genuine
		// upstream bug on the branch that carried it, at 15%.
		for (const overlap of [0, 0.15, 0.5, 1]) {
			const v = classifyVerdict({
				path: 'a',
				existsUpstream: true,
				baseMatchesUpstream: false,
				overlap
			});
			expect(v.relevance).toBe('diverged');
			expect(v.report, `overlap ${overlap} must still be reported`).toBe(true);
			expect(v.overlap).toBe(overlap);
		}
	});

	it('surfaces a shared file it could not measure instead of dismissing it', () => {
		// A binary file, a mode-only change or a submodule yields no comparable
		// text. Reporting it costs a glance; dismissing it loses the finding.
		const v = classifyVerdict({
			path: 'static/favicon.ico',
			existsUpstream: true,
			baseMatchesUpstream: false,
			overlap: null,
			unmeasuredNote: 'binary file, no text to compare'
		});
		expect(v.relevance).toBe('unmeasured');
		expect(v.report).toBe(true);
		expect(v.note).toContain('binary');
	});

	it('treats an absent overlap the same as an explicitly null one', () => {
		expect(
			classifyVerdict({ path: 'a', existsUpstream: true, baseMatchesUpstream: false }).relevance
		).toBe('unmeasured');
	});
});

describe('regionOverlap weighting', () => {
	const upstream = 'export const templateLine = 1;\nother();\n';

	it('lets a removed template line decide, whatever the context around it', () => {
		// The finding this exists for: a one-line fix to template code sits inside
		// a fork-added block, so it carries six lines of fork-only context. Scoring
		// all seven gave 14%, under the threshold, and the fix was dropped: the
		// exact silent false negative the detector is meant to prevent.
		const overlap = regionOverlap(
			[
				{
					removed: ['export const templateLine = 1;'],
					context: ['forkA();', 'forkB();', 'forkC();', 'forkD();', 'forkE();', 'forkF();']
				}
			],
			upstream
		);
		expect(overlap).toBe(1);
	});

	it('falls back to context only when the change removed nothing', () => {
		expect(regionOverlap([{ removed: [], context: ['other();'] }], upstream)).toBe(1);
		expect(regionOverlap([{ removed: [], context: ['forkOnly();'] }], upstream)).toBe(0);
	});

	it('does not let context rescue a removal that is absent upstream', () => {
		expect(
			regionOverlap(
				[{ removed: ['forkOnlyRemoved();'], context: ['export const templateLine = 1;'] }],
				upstream
			)
		).toBe(0);
	});

	it('scores each hunk on its own, so a removal elsewhere cannot bury an insertion', () => {
		// One file, two hunks: a fork-only line deleted in one place, and a guard
		// inserted beside template code in another. Pooling them threw away the
		// second hunk's context entirely (the rule is removed-lines-if-any, and
		// the first hunk supplied one), scoring the file 0% and sorting the most
		// upstream-shaped file on the branch below every trivial one.
		const forkRemoval = { removed: ['forkOnlyCleanup();'], context: [] };
		const upstreamInsertion = { removed: [], context: ['export const templateLine = 1;'] };
		expect(regionOverlap([forkRemoval, upstreamInsertion], upstream)).toBe(1);
		expect(regionOverlap([upstreamInsertion, forkRemoval], upstream)).toBe(1);
	});

	it('keeps one hunk from consuming the matches another needs', () => {
		// One tally shared across hunks lets a weak hunk spend the only copy of a
		// line a strong one needed. Here the first hunk matches a third of itself
		// and takes the line the second hunk consists of entirely: sharing scores
		// the file 33%, and the hunk that made it worth reading is gone.
		const weak = { removed: ['other();', 'forkA();', 'forkB();'], context: [] };
		const strong = { removed: ['other();'], context: [] };
		expect(regionOverlap([weak, strong], upstream)).toBe(1);
	});
});

describe('integration test routing', () => {
	it('keeps repository-spawning tests out of the unit job', () => {
		const root = resolve(import.meta.dirname, '../../../..');
		const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
		const detectorConfig = readFileSync(resolve(import.meta.dirname, 'vitest.config.ts'), 'utf8');
		const workflow = readFileSync(resolve(root, '.github/workflows/static-checks.yml'), 'utf8');
		const integrationPath =
			'.agents/skills/upstream-report/scripts/upstream-relevance.integration.test.ts';

		expect(viteConfig).toContain(`'${integrationPath}'`);
		expect(detectorConfig).toContain('upstream-relevance.test.ts');
		expect(packageJson.scripts['test:upstream-report']).toContain(
			'.agents/skills/upstream-report/scripts/vitest.config.ts'
		);
		expect(packageJson.scripts.test).toContain('bun run test:upstream-report');
		expect(workflow).toContain('run: bun run test:upstream-report');
	});
});
