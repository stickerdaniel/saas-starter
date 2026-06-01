import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

/**
 * Single source of truth for the deterministic per-project Vite frontend ports.
 *
 * Each forked project and each git worktree has a distinct absolute cwd, so the
 * dev and test servers get stable, non-colliding ports with zero coordination.
 * Convex backend ports stay dynamic (see vite.config.ts); only the two frontend
 * ports are derived here.
 *
 * Imported by scripts/dev.ts and scripts/dev-test.ts (where vite is spawned),
 * playwright.config.ts + e2e/utils/site-url.ts (baseURL/webServer), and
 * vite.config.ts (which reuses the port helpers + the portless predicate). Keep
 * this file free of Vite/varlock imports so it stays safe to import from a bare
 * `bun scripts/*` wrapper and from the Playwright config.
 */

// WHATWG fetch "bad port" list. Node's fetch (undici) refuses to connect to
// these, so a Convex backend or site proxy that binds one is unreachable: the
// SvelteKit -> Convex proxy fails with `TypeError: fetch failed` / cause
// `bad port` even though the port was free to bind. Skip them here.
// https://fetch.spec.whatwg.org/#port-blocking
export const BAD_FETCH_PORTS = new Set([
	1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
	103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
	512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
	995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
	6669, 6679, 6697, 10080
]);

type PortProbe = 'free' | 'in-use' | 'unsupported';

// Probe a single address family. Distinguishes a real collision (EADDRINUSE)
// from a family that simply isn't bindable on this host (e.g. ::1 on an
// IPv6-disabled box), which must NOT be treated as a collision.
function probePortFamily(port: number, host: string): Promise<PortProbe> {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.unref();
		server.once('error', (err: NodeJS.ErrnoException) => {
			resolve(err.code === 'EADDRINUSE' ? 'in-use' : 'unsupported');
		});
		server.listen(port, host, () => {
			server.close(() => resolve('free'));
		});
	});
}

export async function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
	return (await probePortFamily(port, host)) !== 'in-use';
}

export async function findAvailablePort(startPort: number, maxAttempts = 100): Promise<number> {
	// Blocked ports don't count toward maxAttempts, so the limit always reflects
	// how many connectable ports were actually probed.
	let checked = 0;
	for (let offset = 0; checked < maxAttempts; offset += 1) {
		const port = startPort + offset;
		if (BAD_FETCH_PORTS.has(port)) continue;
		checked += 1;
		if (await isPortAvailable(port)) {
			return port;
		}
	}

	throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
}

// Deterministic per-cwd frontend ports. Two non-overlapping ranges keep the dev
// server from ever creeping into the test port. Both ranges sit clear of the
// WHATWG bad-fetch ports (max 10080) and below the OS ephemeral range.
const DEV_BASE = 20000;
const TEST_BASE = 21000;
const SPAN = 1000;

/**
 * Resolve a cwd to a stable absolute string. realpath keeps symlinked worktrees
 * stable, but falls back to path.resolve when the path does not exist on disk
 * (realpathSync throws ENOENT) so the helper is testable with synthetic paths.
 */
function normalizeCwd(cwd: string): string {
	try {
		return realpathSync(cwd);
	} catch {
		return path.resolve(cwd);
	}
}

function hashOffset(cwd: string): number {
	const hex = createHash('sha256').update(normalizeCwd(cwd)).digest('hex').slice(0, 8);
	return parseInt(hex, 16) % SPAN;
}

export function computeDevPort(cwd: string = process.cwd()): number {
	return DEV_BASE + hashOffset(cwd);
}

export function computeTestPort(cwd: string = process.cwd()): number {
	return TEST_BASE + hashOffset(cwd);
}

/**
 * Parse a numeric port override env var. Returns undefined when unset/empty.
 * Throws a clear error for invalid values (non-integer, out of 1..65535, or a
 * WHATWG bad-fetch port). These overrides are the documented collision escape
 * hatch, so a bad value must fail loud rather than silently fall back to the
 * computed port (which `Number(x) || fallback` would do).
 */
export function parsePortOverride(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === '') return undefined;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65535 || BAD_FETCH_PORTS.has(port)) {
		throw new Error(
			`${name}="${raw}" is not a valid port. Expected an integer in 1..65535 that is not a WHATWG bad-fetch port.`
		);
	}
	return port;
}

export function resolveDevPort(): number {
	return parsePortOverride('DEV_VITE_PORT') ?? computeDevPort();
}

export function resolveTestPort(): number {
	return parsePortOverride('TEST_VITE_PORT') ?? computeTestPort();
}

/**
 * True when a vercel-labs/portless `.localhost` URL should be the source of
 * truth AND the local stack still runs (so the wrappers must yield port control
 * to portless and skip --port). Distinct from E2E_OVERRIDE_SITE_URL, which
 * points the suite at an external deployment and skips the local stack entirely.
 */
export function portlessOwnsPort(): boolean {
	return !!process.env.PORTLESS_SITE_URL && !process.env.E2E_OVERRIDE_SITE_URL;
}

/**
 * Preflight a deterministic port before spawning Vite with --strictPort. On a
 * collision (another project/worktree hashed to the same port, or a stale
 * server) print an actionable message and exit, instead of dumping a raw
 * EADDRINUSE stack from Vite.
 */
export async function preflightOrExit(port: number, label: 'dev' | 'dev:test'): Promise<void> {
	// The wrappers run vite without --host, so it binds its default `localhost`,
	// which resolves to ::1 and/or 127.0.0.1 depending on the platform (and Node
	// version). Probe both loopback families so a sibling vite is caught whichever
	// one it grabbed; a family that can't be bound at all is not a collision.
	const [v4, v6] = await Promise.all([
		probePortFamily(port, '127.0.0.1'),
		probePortFamily(port, '::1')
	]);
	if (v4 !== 'in-use' && v6 !== 'in-use') return;
	const overrideVar = label === 'dev:test' ? 'TEST_VITE_PORT' : 'DEV_VITE_PORT';
	const runCmd = label === 'dev:test' ? 'bun run test:e2e' : 'bun run dev';
	console.error(
		`\n[${label}] port ${port} is already in use.\n` +
			`  Another project/worktree may have hashed to the same port, or a stale server is holding it.\n` +
			`  Find it:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
			`  Override: ${overrideVar}=<port> ${runCmd}\n`
	);
	process.exit(1);
}
