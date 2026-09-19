import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not Bun's import.meta.dir: the latter is undefined under vitest, which
// is what loads every consumer of this module.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The directory name no walk of the source tree descends into.
 *
 * Matched against the name `readdir` already returned, never against a resolved path: a
 * walk rooted at `path.resolve('src')` and a fixture built from this module's own location
 * disagree the moment the checkout is reached through a symlink, and an exclusion that
 * quietly stops matching puts the race back without failing anything.
 *
 * The spelling is the one already used by `scripts/__fixtures__/` and
 * `scripts/deploy/__fixtures__/`.
 */
export const SOURCE_FIXTURE_DIRECTORY = '__fixtures__';

/**
 * Where a test parks a throwaway source file that the check under test only accepts from
 * inside `src/`.
 *
 * `static-checks.ts` fails any argument outside the repository outright, and its
 * banned-pattern route is a `startsWith('src/')` prefix test, so such a fixture cannot
 * build under `tmpdir()`: one directory higher the check reports "Scanned 0 files" and the
 * case asserts against a run that inspected nothing. It has to sit in the real source tree.
 *
 * That put a directory which appears and vanishes mid-run in the path of every suite that
 * walks `src/`, and a walk that listed the entry before the owning test removed it died on
 * `ENOENT scandir`. Skipping the directory by name is what makes the placement safe: no
 * walk ever stats the fixture, so there is no window between listing it and descending
 * into it.
 *
 * Deliberately committed rather than Git-ignored. Prettier consults `.gitignore` as well
 * as `.prettierignore` (PRETTIER_IGNORE_FILES in static-checks.ts), so ignoring this path
 * would make the formatter skip the fixture and leave the Prettier case asserting against
 * a run that formatted nothing.
 */
export const SOURCE_FIXTURE_ROOT = path.join(REPO_ROOT, 'src', SOURCE_FIXTURE_DIRECTORY);
