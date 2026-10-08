import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function hasGitMetadata() {
	let directory = process.cwd();
	while (true) {
		if (existsSync(join(directory, '.git'))) return true;
		const parent = dirname(directory);
		if (parent === directory) return false;
		directory = parent;
	}
}

/**
 * A deterministic, per-commit app version so the client can detect a new
 * deploy and recover from dead chunk hashes. The default build timestamp is
 * non-deterministic across the two CI build steps within one deploy, which
 * breaks the failed-import safety net. Prefer the commit SHA injected by the
 * build host (Workers Builds, then Vercel), fall back to a local git rev, and
 * finally to 'dev' so non-git build hosts still get a stable name.
 */
export function appVersion(): string {
	const sha =
		process.env.WORKERS_CI_COMMIT_SHA ||
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.APP_BUILD_SHA;
	if (sha) return sha;
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', hasGitMetadata() ? 'inherit' : 'ignore']
		}).trim();
	} catch {
		return 'dev';
	}
}
