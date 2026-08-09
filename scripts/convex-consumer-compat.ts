/**
 * Refuse to remove a Convex function that deployed app code still calls.
 *
 * `scripts/deploy.ts` pushes Convex functions before the SvelteKit build
 * exists, so on an existing deployment every deploy has a window in which the
 * previous app code runs against the new backend, and browser tabs stretch
 * that window indefinitely: the version poll only reloads on the next
 * navigation, so a tab that never navigates keeps calling with its old
 * bundle. A platform rollback widens it further, because it restores old app
 * code while Convex has no function versioning, no aliases and no deployment
 * rollback to restore the surface that code was built against. Previews are
 * outside this reasoning: `--preview-create` recreates the backend, so a
 * stale preview bundle points at a deleted deployment either way. See issue
 * https://github.com/stickerdaniel/saas-starter/issues/789.
 *
 * First ship the new name while keeping the old one published exactly as it
 * was (`export const old = newName` is enough). Server aliases can be removed
 * once no running or rollback-restorable build references them. Browser aliases
 * have no automatic expiry because a tab can stay open indefinitely; deleting
 * one needs separate evidence that supported clients can no longer call it.
 * This check enforces the compatibility release and does not supply that later
 * evidence. Every function the app referenced at the baseline commit must still
 * be published with the same name, kind and visibility. The baseline comes from
 * git, which prevents the commit that removes a function from blessing its own
 * removal.
 *
 * The check is an incomplete lower bound. The consumer side is read as text, so
 * a reference through a renamed import, bracket notation, or assembled from a
 * variable does not register. What it catches reliably is the case that actually
 * happens: a rename done in one commit across both sides.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
	ENTRY_EXTENSIONS,
	surfaceOf,
	type Registration,
	type Surface,
	type Visibility
} from './convex-surface';

const CONVEX_ROOT = 'src/lib/convex';
// Everything under src outside the Convex tree is deployed app code; the
// Convex tree itself deploys atomically with the functions it references.
const CONSUMER_ROOT = 'src';

type Reference = { identifier: string; visibility: Visibility; file: string };

function git(args: string[]): string {
	// stderr captured, not inherited: a probing rev-parse is allowed to fail
	// without printing git's `fatal:` above this script's own explanation.
	return execFileSync('git', args, {
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

type Baseline = { commit: string } | { root: true } | null;

function resolveBaseline(): Baseline {
	// Set by CI on trunk pushes to the push event's pre-push SHA: a push can
	// carry several commits, and HEAD~1 would let the first of them bless a
	// rename the deployed build never saw. Also the way to point the check at a
	// known-bad commit to prove it catches what it was written for. An all-zero
	// SHA (branch creation) falls back to the trunk resolution below; a nonzero
	// SHA that cannot be found fails CI instead of falling back, because the
	// one way that happens on a push is a force push that moved the deployed
	// tip out of reach: exactly the state in which HEAD~1 would bless what
	// that tip still calls.
	const override = process.env.CONVEX_COMPAT_BASE?.trim();
	if (override && !/^0+$/.test(override)) {
		try {
			return { commit: git(['rev-parse', '--verify', `${override}^{commit}`]).trim() };
		} catch {
			try {
				git(['fetch', '--quiet', 'origin', override]);
				return { commit: git(['rev-parse', '--verify', `${override}^{commit}`]).trim() };
			} catch {
				if (process.env.CI) {
					console.error(
						`convex-consumer-compat: CONVEX_COMPAT_BASE=${override} is unreachable (force push?); refusing to guess a baseline for it.`
					);
					process.exit(1);
				}
				console.warn(
					`convex-consumer-compat: CONVEX_COMPAT_BASE=${override} is not a commit here; using the trunk instead.`
				);
			}
		}
	}
	const candidates = ['origin/main', 'main'];
	for (const candidate of candidates) {
		try {
			git(['rev-parse', '--verify', `${candidate}^{commit}`]);
		} catch {
			continue;
		}
		let base: string;
		try {
			// The merge base, not the tip: on a branch that started before an
			// unrelated deletion landed, the tip would demand functions this branch
			// never promised to keep.
			base = git(['merge-base', 'HEAD', candidate]).trim();
		} catch {
			return { commit: candidate };
		}
		// On the trunk itself the merge base is HEAD, and a commit would be asked
		// only about the consumer it just rewrote: it would bless its own removal.
		// Step back to the parent instead (CI pushes land here only when the
		// pre-push SHA above was unusable).
		if (base === git(['rev-parse', 'HEAD']).trim()) {
			try {
				return { commit: git(['rev-parse', 'HEAD~1']).trim() };
			} catch {
				// A root commit has nothing to have promised.
				return { root: true };
			}
		}
		return { commit: base };
	}
	return null;
}

/** `api.users.viewer` -> `users:viewer`. */
function identifiersIn(source: string, file: string): Reference[] {
	const found: Reference[] = [];
	const pattern = /\b(api|internal)\.((?:[A-Za-z0-9_]+\.)+[A-Za-z0-9_]+)/g;
	for (const match of source.matchAll(pattern)) {
		const parts = match[2]!.split('.');
		const fn = parts.pop()!;
		if (parts.length === 0) continue;
		found.push({
			identifier: `${parts.join('/')}:${fn}`,
			visibility: match[1] === 'api' ? 'public' : 'internal',
			file
		});
	}
	return found;
}

// Any deployed source can hold a reference, so this stays wide: declarations
// and tests are out (tests run against the working tree, not production).
// Which of the referenced functions the backend actually published is the
// surface's answer, not this filter's.
function isConsumerSource(line: string): boolean {
	if (/\.d\.[mc]?ts$/.test(line) || /\.(test|spec)\.[a-z]+$/.test(line)) return false;
	return line.endsWith('.svelte') || ENTRY_EXTENSIONS.some((extension) => line.endsWith(extension));
}

function consumerReferencesAt(commit: string): Reference[] {
	const files = git(['ls-tree', '-r', '--name-only', commit, '--', CONSUMER_ROOT])
		.split('\n')
		.filter((line) => isConsumerSource(line) && !line.startsWith(`${CONVEX_ROOT}/`));
	const refs: Reference[] = [];
	for (const file of files) {
		refs.push(...identifiersIn(git(['show', `${commit}:${file}`]), file));
	}
	return refs;
}

/**
 * The surface at the baseline commit, from an isolated checkout.
 *
 * The checkout lives outside the current repository so module resolution cannot
 * fall through to today's dependencies. Its frozen install recreates generated
 * artifacts and the dependency types that shaped the deployed API. The current
 * reader is copied into that checkout and executed there, so it also loads the
 * baseline's TypeScript package.
 */
function surfaceAt(commit: string, protectedIdentifiers: ReadonlySet<string>): Surface {
	const tempRoot = mkdtempSync(path.join(tmpdir(), 'convex-compat-'));
	const dir = path.join(tempRoot, 'baseline');
	let worktreeAdded = false;
	try {
		git(['worktree', 'add', '--detach', '--quiet', dir, commit]);
		worktreeAdded = true;
		try {
			execFileSync('bun', ['install', '--frozen-lockfile'], {
				cwd: dir,
				encoding: 'utf8',
				maxBuffer: 32 * 1024 * 1024,
				stdio: ['ignore', 'pipe', 'pipe']
			});
		} catch (error) {
			throw new Error(`convex-consumer-compat: could not install baseline ${commit.slice(0, 8)}`, {
				cause: error
			});
		}

		const reader = path.join(dir, '.convex-surface-reader.ts');
		copyFileSync(path.join(process.cwd(), 'scripts/convex-surface.ts'), reader);
		const serialized = execFileSync('bun', [reader, path.join(dir, CONVEX_ROOT)], {
			cwd: dir,
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				CONVEX_SURFACE_PROTECTED_IDENTIFIERS: JSON.stringify([...protectedIdentifiers])
			}
		});
		return new Map(JSON.parse(serialized) as Array<[string, Registration]>);
	} finally {
		if (worktreeAdded) {
			try {
				git(['worktree', 'remove', '--force', dir]);
			} catch {
				rmSync(dir, { recursive: true, force: true });
				git(['worktree', 'prune']);
			}
		}
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

const baseline = resolveBaseline();
if (!baseline) {
	const message =
		'convex-consumer-compat: no trunk to compare against (looked for origin/main and main).';
	if (process.env.CI) {
		console.error(`${message} CI needs the full history for this check.`);
		process.exit(1);
	}
	console.warn(`${message} Skipping; CI will run it against the trunk.`);
	process.exit(0);
}
if ('root' in baseline) {
	console.log('convex-consumer-compat: root commit, nothing promised yet.');
	process.exit(0);
}

const baselineReferences = consumerReferencesAt(baseline.commit);
const baselineIdentifiers = new Set(baselineReferences.map((ref) => ref.identifier));
const promised = surfaceAt(baseline.commit, baselineIdentifiers);
// A reference only counts if the baseline actually delivered it the way the
// consumer asked (public through `api.`, internal through `internal.`): one
// that did not match was broken or noise already.
const required = baselineReferences.filter(
	(ref) => promised.get(ref.identifier)?.visibility === ref.visibility
);
const available = surfaceOf(CONVEX_ROOT, new Set(required.map((ref) => ref.identifier)));
const broken = required.filter((ref) => {
	const was = promised.get(ref.identifier)!;
	const now = available.get(ref.identifier);
	return !now || now.kind !== was.kind || now.visibility !== ref.visibility;
});

if (broken.length === 0) {
	console.log(
		`convex-consumer-compat: ${new Set(required.map((r) => r.identifier)).size} referenced functions still published unchanged.`
	);
	process.exit(0);
}

const byIdentifier = new Map<string, Reference[]>();
for (const ref of broken) {
	byIdentifier.set(ref.identifier, [...(byIdentifier.get(ref.identifier) ?? []), ref]);
}

console.error('convex-consumer-compat: deployed app code would lose these functions.\n');
for (const [identifier, refs] of byIdentifier) {
	const was = promised.get(identifier)!;
	const now = available.get(identifier);
	const fate = !now
		? 'no longer exported'
		: now.kind !== was.kind
			? `now a ${now.kind}, was a ${was.kind}`
			: `now ${now.visibility}, was ${refs[0]!.visibility}`;
	console.error(`  ${identifier}: ${fate}`);
	console.error(
		`    referenced at ${baseline.commit.slice(0, 8)} from ${[...new Set(refs.map((r) => r.file))].join(', ')}`
	);
}
console.error(
	'\nConvex deploys before the app build, stale browser tabs outlive both, and a\n' +
		'platform rollback restores old app code against the new backend. Keep the old\n' +
		'name published exactly as it was. An alias to the new implementation is\n' +
		'enough. Remove it only after no supported client can call it. See\n' +
		'https://github.com/stickerdaniel/saas-starter/issues/789.'
);
process.exit(1);
