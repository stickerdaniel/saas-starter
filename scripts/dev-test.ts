import 'varlock/auto-load';
import { portlessOwnsPort, preflightOrExit, resolveTestPort } from './dev-ports';

const testPort = resolveTestPort();
const TEST_BASE_URL = `http://localhost:${testPort}`;

if (process.env.PUBLIC_CONVEX_URL) {
	console.warn(
		`[dev:test] WARNING: PUBLIC_CONVEX_URL=${process.env.PUBLIC_CONVEX_URL} is set in your env. ` +
			`Local test backend file (.convex/.test-backend-url) will be used instead — see e2e/utils/convex-url.ts. ` +
			`Remove PUBLIC_CONVEX_URL from .env.test to silence this warning.`
	);
}
// In portless mode the forced origin is the named .localhost URL, not the local
// port, so name the URL the suite will actually use.
const forcedSiteUrl = portlessOwnsPort() ? process.env.PORTLESS_SITE_URL! : TEST_BASE_URL;
if (process.env.PUBLIC_SITE_URL && process.env.PUBLIC_SITE_URL !== forcedSiteUrl) {
	console.warn(
		`[dev:test] WARNING: PUBLIC_SITE_URL=${process.env.PUBLIC_SITE_URL} is set. ` +
			`Local test mode forces ${forcedSiteUrl} — see e2e/utils/site-url.ts.`
	);
}

// --strictPort: vite's default is to find the next free port if testPort is taken;
// that would silently start a second test backend on a different port and break
// playwright's port expectation. Preflight first so a collision (sibling project,
// stale server) surfaces as an actionable message instead of a raw EADDRINUSE.
// When portless owns the port, yield control (no --port/--strictPort) so portless
// can front vite on its named .localhost URL.
// We deliberately do NOT pass --host. Vite's default host is `localhost`, which makes
// resolvedUrls.local[0] resolve to `${TEST_BASE_URL}/`. That value is forwarded as
// SITE_URL into the Convex backend (vite.config.ts envVars callback) and becomes the
// trustedOrigin for BetterAuth. Test setup sends Origin: ${TEST_BASE_URL} — the
// hostnames must match. Forcing --host 127.0.0.1 here breaks BetterAuth's origin check.
let portArgs: string[] = [];
if (!portlessOwnsPort()) {
	await preflightOrExit(testPort, 'dev:test');
	portArgs = ['--port', String(testPort), '--strictPort'];
}

const child = Bun.spawn(['vite', 'dev', ...portArgs], {
	stdio: ['inherit', 'inherit', 'inherit'],
	// Pin npm_lifecycle_event in the explicit env: Bun.spawn does NOT forward
	// runtime mutations of process.env to the child, so vite.config.ts only sees
	// test mode reliably when it is set here (not via a bare assignment above).
	env: { ...process.env, npm_lifecycle_event: 'dev:test' }
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
