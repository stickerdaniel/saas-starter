import { portlessOwnsPort, preflightOrExit, resolveDevPort } from './dev-ports';

// Wrapper for `bun run dev` and `bun run dev:frontend`. Spawns vite on a
// deterministic per-project port (see scripts/dev-ports.ts) so parallel
// projects/worktrees never collide. --strictPort + preflight turn a collision
// into a clear message instead of a silent port bump (which previously let the
// dev server creep into the E2E port). When portless owns the port, yield
// control: skip --port so portless can front vite on its named .localhost URL.
let portArgs: string[] = [];
if (!portlessOwnsPort()) {
	const port = resolveDevPort();
	await preflightOrExit(port, 'dev');
	portArgs = ['--port', String(port), '--strictPort'];
}

// We deliberately do NOT pass --host (see scripts/dev-test.ts for the reasoning):
// vite's default host `localhost` keeps resolvedUrls.local[0] aligned with the
// BetterAuth trustedOrigin derived from it.
const child = Bun.spawn(['vite', 'dev', ...portArgs], {
	stdio: ['inherit', 'inherit', 'inherit'],
	// Pass env explicitly: Bun.spawn forwards inherited shell env vars but NOT
	// runtime mutations of process.env. vite.config.ts branches on
	// npm_lifecycle_event (`dev` starts the local Convex backend; `dev:frontend`,
	// used by `dev:cloud`, skips it), so forward the current env verbatim.
	env: { ...process.env }
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
