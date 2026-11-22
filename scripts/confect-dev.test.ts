import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkoutLockPath } from './checkout-lock';
import {
	awaitStartup,
	checkStartupStatus,
	classifyChange,
	cloudPushEnv,
	commandPush,
	createChangeFilter,
	createRun,
	createRunQueue,
	readAdminKey
} from './confect-dev';
import {
	CONFECT_GENERATED_DIR,
	CONVEX_DIR,
	confectPreflight,
	type Codegen,
	type Push
} from './confect-codegen';
import { computeLocalConvexStateId } from './local-convex-env';

const NONCE = 'nonce-1';
const URL = 'http://localhost:4100';

const marker = (fields: Record<string, string> = {}) =>
	JSON.stringify({ outcome: 'success', backendUrl: URL, nonce: NONCE, mode: 'dev', ...fields });

const expected = { mode: 'dev' as const, nonce: NONCE, backendUrl: URL };

const roots: string[] = [];

function write(root: string, file: string, contents: string): void {
	mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
	writeFileSync(path.join(root, file), contents);
}

function read(root: string, file: string): string {
	return readFileSync(path.join(root, file), 'utf8');
}

function checkout(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'confect-dev-checkout-'));
	roots.push(root);
	write(root, 'package.json', '{}');
	write(root, `${CONVEX_DIR}/convex.config.ts`, 'export default 1;\n');
	write(root, 'src/lib/confect/a.ts', 'batch-0\n');
	write(root, 'src/lib/confect/b.ts', 'batch-0\n');
	const result = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(result.stderr);
	return root;
}

const generates: Codegen = (scratch) => {
	write(scratch, `${CONFECT_GENERATED_DIR}/example.ts`, 'export const ok = true;\n');
};

function gate() {
	let open = () => {};
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { opened, open };
}

async function until(condition: () => boolean): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error('condition not reached');
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(checkoutLockPath(root), { force: true });
		rmSync(root, { recursive: true, force: true });
	}
});

describe('startup marker', () => {
	it('is pending while the marker is missing', () => {
		expect(checkStartupStatus(undefined, expected)).toEqual({ state: 'pending' });
	});

	it('accepts a success marker with this start, mode and backend URL', () => {
		expect(checkStartupStatus(marker(), expected)).toEqual({ state: 'ready', backendUrl: URL });
	});

	it('rejects a marker from another start', () => {
		expect(checkStartupStatus(marker({ nonce: 'nonce-0' }), expected).state).toBe('failed');
	});

	it('rejects a failure marker', () => {
		expect(checkStartupStatus(marker({ outcome: 'failure' }), expected).state).toBe('failed');
	});

	it('rejects the marker of the other local mode', () => {
		expect(checkStartupStatus(marker({ mode: 'dev:test' }), expected).state).toBe('failed');
	});

	it('waits while the URL file names another backend or is missing', () => {
		expect(checkStartupStatus(marker(), { ...expected, backendUrl: 'http://localhost:1' })).toEqual(
			{ state: 'pending' }
		);
		expect(checkStartupStatus(marker(), { ...expected, backendUrl: undefined })).toEqual({
			state: 'pending'
		});
	});

	it('rejects malformed JSON and extra fields', () => {
		expect(checkStartupStatus('{"outcome":', expected).state).toBe('failed');
		expect(checkStartupStatus(marker({ adminKey: 'k' }), expected).state).toBe('failed');
	});
});

describe('startup barrier', () => {
	const signal = new AbortController().signal;

	it('returns the backend URL once the marker turns ready', async () => {
		const reads: Array<string | undefined> = [undefined, undefined, marker()];
		let polls = 0;
		const url = await awaitStartup({
			read: () => {
				polls += 1;
				return checkStartupStatus(reads.shift(), expected);
			},
			exited: new Promise(() => {}),
			signal
		});

		expect(url).toBe(URL);
		expect(polls).toBe(3);
	});

	it('fails when Vite has exited even though a ready marker is present', async () => {
		await expect(
			awaitStartup({
				read: () => checkStartupStatus(marker(), expected),
				exited: Promise.resolve(42),
				signal
			})
		).rejects.toThrow('Vite exited with 42 before the startup marker');
	});

	it('fails when Vite exits before the marker', async () => {
		await expect(
			awaitStartup({
				read: () => checkStartupStatus(undefined, expected),
				exited: Promise.resolve(0),
				signal
			})
		).rejects.toThrow('before the startup marker');
	});

	it('fails after the deadline without a marker', async () => {
		await expect(
			awaitStartup({
				read: () => checkStartupStatus(undefined, expected),
				exited: new Promise(() => {}),
				signal,
				deadlineMs: 150
			})
		).rejects.toThrow('no startup marker');
	});
});

describe('run queue', () => {
	it('holds changes until the queue opens, then runs once', async () => {
		const queue = createRunQueue();
		let runs = 0;
		queue.request();
		queue.request();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(runs).toBe(0);

		queue.open(async () => {
			runs += 1;
		});
		await queue.settled();

		expect(runs).toBe(1);
	});

	it('coalesces changes during a run into one follow-up run', async () => {
		const queue = createRunQueue();
		const first = gate();
		let runs = 0;
		queue.open(async () => {
			runs += 1;
			if (runs === 1) await first.opened;
		});
		queue.request();
		await until(() => runs === 1);
		queue.request();
		queue.request();
		first.open();
		await until(() => runs === 2);
		await queue.settled();

		expect(runs).toBe(2);
	});
});

describe('watch set', () => {
	it.each([
		['src/lib/confect/aiChat/titles.impl.ts', 'source'],
		['src/lib/dev/features.ts', 'source'],
		['src/routes/+page.svelte', 'source'],
		['src/lib/confect/support/instructions.txt', 'source'],
		['src/lib/convex/convex.config.ts', 'source'],
		['.env-convex.schema', 'source'],
		['src/lib/confect/support/instructions.generated.ts', 'ignored'],
		['src/lib/confect/_generated/refs.ts', 'ignored'],
		['src/lib/convex/_generated/api.d.ts', 'ignored'],
		['src/lib/convex/aiChat/titles.ts', 'ignored'],
		['README.md', 'ignored'],
		['convex.json', 'restart'],
		['package.json', 'restart'],
		['bun.lock', 'restart'],
		['vite.config.ts', 'restart']
	])('classifies %s as %s', (file, kind) => {
		expect(classifyChange(file)).toBe(kind);
	});
});

describe('change filter', () => {
	it('ignores an event for a file nobody changed since the watch started', async () => {
		const root = checkout();
		const file = path.join(root, 'src/lib/confect/a.ts');
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(createChangeFilter()(file)).toBe(false);
	});

	it('reports a write once and a deletion', async () => {
		const root = checkout();
		const file = path.join(root, 'src/lib/confect/a.ts');
		const changed = createChangeFilter();
		await new Promise((resolve) => setTimeout(resolve, 20));
		writeFileSync(file, 'edited\n');

		expect(changed(file)).toBe(true);
		expect(changed(file)).toBe(false);
		rmSync(file);
		expect(changed(file)).toBe(true);
	});
});

describe('development run', () => {
	it('gives two pushes that each see one complete batch when the second arrives mid-push', async () => {
		const root = checkout();
		const firstPush = gate();
		const seen: string[][] = [];
		let reading = false;
		const push: Push = async (scratch) => {
			const files = [read(scratch, 'src/lib/confect/a.ts')];
			reading = true;
			if (seen.length === 0) await firstPush.opened;
			files.push(read(scratch, 'src/lib/confect/b.ts'));
			seen.push(files.map((text) => text.trim()));
		};
		const queue = createRunQueue();
		queue.open(
			createRun({
				root,
				push,
				signal: new AbortController().signal,
				log: () => {},
				codegen: generates,
				generateContent: () => {}
			})
		);
		write(root, 'src/lib/confect/a.ts', 'batch-1\n');
		write(root, 'src/lib/confect/b.ts', 'batch-1\n');
		queue.request();
		await until(() => reading);
		write(root, 'src/lib/confect/a.ts', 'batch-2\n');
		write(root, 'src/lib/confect/b.ts', 'batch-2\n');
		queue.request();
		firstPush.open();
		await until(() => seen.length === 2);
		await queue.settled();

		expect(seen).toEqual([
			['batch-1', 'batch-1'],
			['batch-2', 'batch-2']
		]);
		expect(existsSync(path.join(root, CONFECT_GENERATED_DIR, 'example.ts'))).toBe(true);
	}, 60_000);

	it('keeps an authored file a developer changes during the push', async () => {
		const root = checkout();
		const push: Push = async () => {
			write(root, `${CONVEX_DIR}/convex.config.ts`, 'export default 2;\n');
		};
		const logs: string[] = [];
		await createRun({
			root,
			push,
			signal: new AbortController().signal,
			log: (line) => logs.push(line),
			codegen: generates,
			generateContent: () => {}
		})();

		expect(logs.at(-1)).toMatch(/^Pushed/);
		expect(read(root, `${CONVEX_DIR}/convex.config.ts`)).toBe('export default 2;\n');
	}, 60_000);

	it('reports a failed push and applies no generated file', async () => {
		const root = checkout();
		const logs: string[] = [];
		await createRun({
			root,
			push: async () => {
				throw new Error('the push exited with 1');
			},
			signal: new AbortController().signal,
			log: (line) => logs.push(line),
			codegen: generates,
			generateContent: () => {}
		})();

		expect(logs.at(-1)).toContain('Run failed: the push exited with 1');
		expect(existsSync(path.join(root, CONFECT_GENERATED_DIR, 'example.ts'))).toBe(false);
	}, 60_000);
});

describe('push command', () => {
	const resistsSigterm = (exitAfterMs: number) =>
		`const fs = require('node:fs'); process.on('SIGTERM', () => {}); fs.writeFileSync(process.env.READY_FILE, String(process.pid)); setTimeout(() => { fs.writeFileSync(process.env.EXIT_FILE, ''); process.exit(0); }, ${exitAfterMs});`;

	async function startResistant(
		exitAfterMs: number,
		limits: { timeoutMs: number; graceMs: number }
	) {
		const dir = mkdtempSync(path.join(tmpdir(), 'confect-push-'));
		roots.push(dir);
		const readyFile = path.join(dir, 'ready');
		const exitFile = path.join(dir, 'exited');
		const controller = new AbortController();
		const push = commandPush(
			[process.execPath, '-e', resistsSigterm(exitAfterMs)],
			{ ...process.env, READY_FILE: readyFile, EXIT_FILE: exitFile },
			limits
		)(dir, controller.signal);
		const outcome = push.then(
			() => ({ error: undefined, exited: existsSync(exitFile) }),
			(error: unknown) => ({ error: String(error), exited: existsSync(exitFile) })
		);
		await expect.poll(() => existsSync(readyFile), { timeout: 5_000 }).toBe(true);
		return { controller, outcome, pid: Number(readFileSync(readyFile, 'utf8')) };
	}

	function alive(pid: number) {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	it('rejects a cancelled push only after the child exits, even when it exits 0', async () => {
		const { controller, outcome } = await startResistant(1_000, {
			timeoutMs: 60_000,
			graceMs: 30_000
		});
		controller.abort();

		expect(await outcome).toEqual({ error: 'Error: the push was cancelled', exited: true });
	}, 10_000);

	it('kills a child that ignores SIGTERM after the timeout and grace, then rejects', async () => {
		const { outcome, pid } = await startResistant(60_000, { timeoutMs: 300, graceMs: 300 });

		expect(await outcome).toEqual({
			error: 'Error: the push timed out after 300 ms',
			exited: false
		});
		expect(alive(pid)).toBe(false);
	}, 10_000);
});

describe('deploy preflight', () => {
	it('writes the codegen output into the checkout', async () => {
		const root = checkout();

		await confectPreflight(root, { codegen: generates, generateContent: () => {} });

		expect(read(root, `${CONFECT_GENERATED_DIR}/example.ts`)).toBe('export const ok = true;\n');
	}, 60_000);

	it('fails on an unexpected JSON file in the functions directory and writes nothing', async () => {
		const root = checkout();
		const writesJson: Codegen = (scratch, profile) => {
			generates(scratch, profile);
			write(scratch, `${CONVEX_DIR}/unexpected.json`, '{}');
		};

		await expect(
			confectPreflight(root, { codegen: writesJson, generateContent: () => {} })
		).rejects.toThrow(`created ${CONVEX_DIR}/unexpected.json`);
		expect(existsSync(path.join(root, CONVEX_DIR, 'unexpected.json'))).toBe(false);
		expect(existsSync(path.join(root, CONFECT_GENERATED_DIR))).toBe(false);
	}, 60_000);

	it('fails when the codegen would change an authored file', async () => {
		const root = checkout();
		const altersConfig: Codegen = (scratch, profile) => {
			generates(scratch, profile);
			write(scratch, `${CONVEX_DIR}/convex.config.ts`, 'ALTERED\n');
		};

		await expect(
			confectPreflight(root, { codegen: altersConfig, generateContent: () => {} })
		).rejects.toThrow(`changed ${CONVEX_DIR}/convex.config.ts`);
		expect(read(root, `${CONVEX_DIR}/convex.config.ts`)).toBe('export default 1;\n');
	}, 60_000);
});

describe('local credentials', () => {
	it('reads the admin key of its own mode', () => {
		const root = checkout();
		write(root, `.convex/${computeLocalConvexStateId(root)}/keys.json`, '{"adminKey":"dev-key"}');
		write(
			root,
			`.convex/${computeLocalConvexStateId(root, 'e2e')}/keys.json`,
			'{"adminKey":"test-key"}'
		);

		expect(readAdminKey(root, 'dev')).toBe('dev-key');
		expect(readAdminKey(root, 'dev:test')).toBe('test-key');
	});

	it('fails without a key for its mode', () => {
		const root = checkout();
		write(root, `.convex/${computeLocalConvexStateId(root)}/keys.json`, '{"adminKey":"dev-key"}');

		expect(() => readAdminKey(root, 'dev:test')).toThrow('holds no admin key');
	});
});

describe('cloud push environment', () => {
	it('forwards the deployment selected only in the ignored .env.local', () => {
		const root = checkout();
		write(
			root,
			'.env.local',
			'CONVEX_DEPLOYMENT=dev:example-123 # team: t\nCONVEX_URL=https://example.convex.cloud\n'
		);

		const env = cloudPushEnv(root, { PATH: '/bin' });

		expect(env.CONVEX_DEPLOYMENT).toBe('dev:example-123');
		expect(env.CONVEX_URL).toBeUndefined();
		expect(env.PATH).toBe('/bin');
	});

	it('keeps a deployment the process environment already selects', () => {
		const root = checkout();
		write(root, '.env.local', 'CONVEX_DEPLOYMENT=dev:from-file\n');

		expect(cloudPushEnv(root, { CONVEX_DEPLOYMENT: 'dev:from-env' }).CONVEX_DEPLOYMENT).toBe(
			'dev:from-env'
		);
	});
});
