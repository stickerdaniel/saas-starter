import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizedGitEnv } from '../../git-context';
import { testExecutable } from '../../test-executable';
import type { PrivateCheckout } from './private-checkout';

/**
 * Test budget for a describe block whose tests start the checker in a child Bun.
 * Loading its imports takes about a second idle, and CPU contention multiplies
 * that: in a fork, a case measured at 1.8s idle took 5.6s beside a whole-project
 * check, past Vitest's 5s default. This matches the file-wide budget in
 * `static-checks.format.test.ts`.
 */
export const CHECKER_SPAWN_TIMEOUT = 30_000;

/**
 * `evaluateInCheckout` bound to a test file's private checkout. `checkout` is read on each
 * call, so the binding can be made at module level, before the checkout exists.
 */
export function checkoutEvaluator(checkout: () => PrivateCheckout) {
	/**
	 * Evaluates `expression` in a child Bun, started in the private checkout, where `checks` is
	 * that checkout's own static-checks module. Its exports resolve paths against their module's
	 * repository, so an in-process call would read the shared checkout instead of the fixture.
	 */
	return function evaluateInCheckout(
		expression: string,
		values: readonly unknown[] = [],
		env = sanitizedGitEnv()
	): unknown {
		const { repository } = checkout();
		const module = pathToFileURL(path.join(repository, 'scripts', 'static-checks.ts')).href;
		const result = spawnSync(
			testExecutable('bun'),
			[
				'-e',
				`const [moduleUrl, encoded] = process.argv.slice(1);\nconst checks = await import(moduleUrl);\nconst values = JSON.parse(encoded);\nprocess.stdout.write(JSON.stringify(await (${expression})));`,
				module,
				JSON.stringify(values)
			],
			{ cwd: repository, env, timeout: 20_000, killSignal: 'SIGKILL', encoding: 'utf8' }
		);
		if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
		return JSON.parse(result.stdout);
	};
}
