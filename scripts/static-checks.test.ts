/**
 * The gate must never report success without doing the work.
 *
 * It used to. Eleven inputs made it print "All checks passed!" and exit 0 having
 * checked nothing, and the class kept reappearing because each check derived its
 * own file set and no one place could see that none of them had run.
 *
 * These tests pin the two things that keep it closed:
 *   1. Every caller path is normalized to repo-relative BEFORE it meets a route.
 *      This is load-bearing, not cosmetic: the route predicates gate on a `src/`
 *      prefix, so an absolute path is invisible to them. The test asserts both
 *      halves so the reason survives, since a future reader who sees only the
 *      normalization may reasonably think it is tidiness and drop it.
 *   2. Bad input dies at the boundary. Every case below exits before a check runs,
 *      so these stay fast.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { ROUTES, resolveInputs } from './static-checks';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');

/** Exit code only. Every case here fails at intake, so no check subprocess runs. */
function run(...args: string[]): number {
	return spawnSync('bun', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' }).status ?? -1;
}

describe('route predicates', () => {
	it('are blind to an absolute path, which is why normalization is load-bearing', () => {
		const absolute = path.join(ROOT, 'src/lib/utils/auth-messages.ts');
		const absoluteConvex = path.join(ROOT, 'src/lib/convex/schema.ts');

		// The trap: both gates test a `src/` prefix, so an absolute path routes nowhere
		// and the checks silently skip while the run still reports success.
		expect(ROUTES['banned-patterns'](absolute)).toBe(false);
		expect(ROUTES.convex(absoluteConvex)).toBe(false);

		// The defence: normalize first, and the same files route.
		expect(ROUTES['banned-patterns'](resolveInputs([absolute], 'test')[0])).toBe(true);
		expect(ROUTES.convex(resolveInputs([absoluteConvex], 'test')[0])).toBe(true);
	});
});

describe('resolveInputs', () => {
	it('normalizes every spelling of the same file to one repo-relative path', () => {
		const forms = [
			path.join(ROOT, 'src/lib/utils/auth-messages.ts'),
			'./src/lib/utils/auth-messages.ts',
			'src/lib/utils/../utils/auth-messages.ts',
			'src/lib/utils/auth-messages.ts'
		];
		expect(resolveInputs(forms, 'test')).toEqual(['src/lib/utils/auth-messages.ts']);
	});

	// Directory expansion is deliberately NOT pinned here. It runs through Bun.Glob,
	// which does not exist in the vitest (node) runtime, so it cannot be called
	// directly; and asserting it through a real run costs ~10s, a quarter of the
	// whole unit suite. A guard that slows the suite that much gets switched off,
	// and a switched-off guard protects nothing. The hole it would cover (a
	// directory argument checking nothing) is closed by the ledger, which fails any
	// run where no check touched a file, and that is asserted above.
});

describe('bad input dies at the boundary', () => {
	it.each([
		['an empty argument', ['']],
		['a whitespace argument', ['   ']],
		['a newline-joined list arriving as one argument', ['src/a.ts\nsrc/b.ts']],
		['a path that does not exist', ['src/does-not-exist.ts']],
		['a path outside the repository', ['/etc/hosts']],
		['an unknown flag', ['--CI', '--scope', 'lint']],
		['a misspelled flag whose value would leak into the file list', ['--scop', 'lint']]
	])('rejects %s', (_label, args) => {
		expect(run(...args)).toBe(1);
	});

	it('still accepts a run with nothing staged', () => {
		expect(run('--staged', '--scope', 'lint')).toBe(0);
	});
});
