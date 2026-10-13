/**
 * stale-marker.ts: stop discovery in a checkout that lacks a newer `.upstream-sync.json`
 * from the fork's own trunk.
 *
 * Discovery scopes the review range from the marker in the working tree. A shared
 * checkout that lags origin still holds the marker from before the last sync, so it
 * would list commits that sync already reviewed. A fresh `bun run worktree` branches
 * from the fetched trunk and passes.
 */
import { execFileSync } from 'node:child_process';

const MARKER = '.upstream-sync.json';

// Stop message when origin's default branch has marker commits HEAD lacks, otherwise
// null. It fetches `origin HEAD` and compares against the fetched commit itself, so a
// missing origin/HEAD symref or a narrowed fetch refspec cannot hide a newer marker.
// A missing or unreachable origin passes.
export function staleMarkerMessage(env: NodeJS.ProcessEnv): string | null {
	const git = (args: string[]) => {
		try {
			return execFileSync('git', args, {
				encoding: 'utf-8',
				env,
				stdio: ['ignore', 'pipe', 'ignore']
			}).trim();
		} catch {
			return null;
		}
	};
	if (git(['fetch', '--quiet', 'origin', 'HEAD']) === null) return null;
	const trunk = git(['rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}']);
	if (!trunk) return null;
	const missing = git(['log', '-1', '--format=%h %s', `HEAD..${trunk}`, '--', `:(top)${MARKER}`]);
	if (!missing) return null;
	return (
		`This checkout lacks the ${MARKER} change on origin's default branch (${missing}), ` +
		`so the review range would repeat commits an earlier sync already reviewed.\n` +
		'Run discovery from a fresh worktree instead: `bun run worktree chore/upstream-sync`.'
	);
}
