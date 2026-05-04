import 'varlock/auto-load';
import { TEST_VITE_PORT } from '../e2e/utils/site-url';

const TEST_BASE_URL = `http://localhost:${TEST_VITE_PORT}`;

if (process.env.PUBLIC_CONVEX_URL) {
	console.warn(
		`[dev:test] WARNING: PUBLIC_CONVEX_URL=${process.env.PUBLIC_CONVEX_URL} is set in your env. ` +
			`Local test backend file (.convex/.test-backend-url) will be used instead — see e2e/utils/convex-url.ts. ` +
			`Remove PUBLIC_CONVEX_URL from .env.test to silence this warning.`
	);
}
if (process.env.PUBLIC_SITE_URL && process.env.PUBLIC_SITE_URL !== TEST_BASE_URL) {
	console.warn(
		`[dev:test] WARNING: PUBLIC_SITE_URL=${process.env.PUBLIC_SITE_URL} is set. ` +
			`Local test mode forces ${TEST_BASE_URL} — see e2e/utils/site-url.ts.`
	);
}

process.env.npm_lifecycle_event = 'dev:test';

// --strictPort: vite's default is to find the next free port if TEST_VITE_PORT is taken;
// that would silently start a second test backend on a different port and break
// playwright's port expectation.
// We deliberately do NOT pass --host. Vite's default host is `localhost`, which makes
// resolvedUrls.local[0] resolve to `${TEST_BASE_URL}/`. That value is forwarded as
// SITE_URL into the Convex backend (vite.config.ts envVars callback) and becomes the
// trustedOrigin for BetterAuth. Test setup sends Origin: ${TEST_BASE_URL} — the
// hostnames must match. Forcing --host 127.0.0.1 here breaks BetterAuth's origin check.
const child = Bun.spawn(['vite', 'dev', '--port', String(TEST_VITE_PORT), '--strictPort'], {
	stdio: ['inherit', 'inherit', 'inherit']
});

const onSignal = (signal: NodeJS.Signals) => {
	try {
		child.kill(signal);
	} catch {
		/* already dead */
	}
};
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

const code = await child.exited;
process.exit(code ?? 0);
