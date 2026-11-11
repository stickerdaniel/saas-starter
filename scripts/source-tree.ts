/**
 * The directory name no walk of the source tree descends into: a fixture directory holds test
 * inputs, never application source.
 *
 * Matched against the name `readdir` already returned, never against a resolved path, so the
 * exclusion keeps matching when the checkout is reached through a symlink.
 *
 * The spelling is the one already used by `scripts/__fixtures__/` and
 * `scripts/deploy/__fixtures__/`.
 */
export const SOURCE_FIXTURE_DIRECTORY = '__fixtures__';
