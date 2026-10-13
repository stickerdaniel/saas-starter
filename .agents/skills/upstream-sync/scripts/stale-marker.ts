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

// Stop message when origin's trunk has marker commits HEAD lacks, otherwise null.
// Fetches the trunk first; an unreachable or missing origin passes silently.
export function staleMarkerMessage(env: NodeJS.ProcessEnv): string | null {
	const git = (args: string[]) => {
		try {
			return execFileSync('git', args, {
				encoding: 'utf-8',
				env,
				stdio: ['ignore', 'pipe', 'ignore']
			}).trim();
		} catch {
			return '';
		}
	};
	const trunk =
		git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']) || 'origin/main';
	git(['fetch', '--quiet', 'origin', trunk.replace(/^origin\//, '')]);
	const missing = git(['log', '-1', '--format=%h %s', `HEAD..${trunk}`, '--', `:(top)${MARKER}`]);
	if (!missing) return null;
	return (
		`This checkout lacks ${trunk}'s ${MARKER} change (${missing}), so the review range ` +
		`would repeat commits an earlier sync already reviewed.\n` +
		'Run discovery from a fresh worktree instead: `bun run worktree chore/upstream-sync`.'
	);
}
