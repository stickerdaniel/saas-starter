import fs from 'node:fs';
import path from 'node:path';

const POLL_INTERVAL_MS = 2_000;

/**
 * The `dev:test` server writes this file when its Convex backend exits on its
 * own, and Playwright's global setup reads it. Playwright stops watching a
 * webServer once it answered, so this file is the only report of a crash.
 */
export function testBackendExitFile(cwd = process.cwd()): string {
	return path.join(cwd, '.convex', '.test-backend-exit');
}

export function clearTestBackendExit(cwd = process.cwd()): void {
	fs.rmSync(testBackendExitFile(cwd), { force: true });
}

export function recordTestBackendExit(error: Error, cwd = process.cwd()): void {
	fs.writeFileSync(testBackendExitFile(cwd), error.message);
}

function readTestBackendExit(cwd: string): string | undefined {
	try {
		return fs.readFileSync(testBackendExitFile(cwd), 'utf8');
	} catch {
		return undefined;
	}
}

export function watchTestBackendExit(
	onExit: (error: string) => void,
	{ cwd = process.cwd(), intervalMs = POLL_INTERVAL_MS } = {}
): () => void {
	const timer = setInterval(() => {
		const error = readTestBackendExit(cwd);
		if (error === undefined) return;
		clearInterval(timer);
		onExit(error);
	}, intervalMs);
	timer.unref();
	return () => clearInterval(timer);
}
