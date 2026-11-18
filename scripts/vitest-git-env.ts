/**
 * Tooling tests build Git fixtures in temporary directories and run Git-reading code against
 * them. A `GIT_DIR` or `GIT_WORK_TREE` inherited from the caller, such as `git rebase --exec`,
 * would point both at the caller's checkout instead, so each test file starts without them.
 */
import { sanitizedGitEnv } from './git-context';

const clean = sanitizedGitEnv();
for (const key of Object.keys(process.env)) {
	if (!(key in clean)) delete process.env[key];
}
