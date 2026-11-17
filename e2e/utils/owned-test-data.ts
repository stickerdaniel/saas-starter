// Write-ahead ownership ledger for the backend data an E2E run creates.
//
// Global setup opens one run directory, `e2e/.auth/owned/<runId>/`, and passes its
// ID to the workers through `E2E_OWNERSHIP_RUN_ID`. Each worker process records
// what it is about to create in its own attempt file, `w<workerIndex>.json`,
// before the backend write. Playwright replaces a crashed worker under a new
// `workerIndex`, so the dead attempt's file stays next to its replacement's.
// Global teardown reads every attempt file of the run, deletes exactly what they
// list, and removes the directory only after a read-back finds nothing left.
//
//   ownTestEmail(email, 'userEmails');          // before the sign-up request
//   ownAnonymousSupportOwner(anonymousUserId);  // before the first support thread
//   ownSupportThreads(created.threadIds);       // as soon as the IDs return
//   const fixtureToken = ownFixture({ kind: 'aiChatHistory' }); // before the seed

import { randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { isAnonymousUser } from '../../src/lib/convex/utils/anonymousUser';

const RUN_ID_ENV = 'E2E_OWNERSHIP_RUN_ID';
const root = join(process.cwd(), 'e2e', '.auth', 'owned');
// The single-file ledger of earlier checkouts; a leftover one lists data no run cleaned.
const legacyLedger = join(process.cwd(), 'e2e', '.auth', 'owned-test-data.json');

// Every test-only fixture carries its token, so recovery deletes rows by token
// and never by a user ID that a real account might hold.
const ownedFixture = z.discriminatedUnion('kind', [
	// Audit rows are found through the `by_admin` index of their fixture ID.
	z.object({ kind: z.literal('auditLog'), token: z.string(), fixtureId: z.string() }),
	z.object({ kind: z.literal('aiChatHistory'), token: z.string() }),
	z.object({ kind: z.literal('supportNotification'), token: z.string() })
]);
const ownedAttempt = z.object({
	runId: z.string(),
	workerIndex: z.number().int(),
	userEmails: z.array(z.string()),
	recipientEmails: z.array(z.string()),
	/** Anonymous support IDs; teardown adds the user IDs of owned accounts. */
	supportOwners: z.array(z.string()),
	/**
	 * Support threads by ID. A spec's own cleanup can delete the app rows that
	 * teardown finds threads through while the agent thread survives, so the IDs
	 * go here before that cleanup runs.
	 */
	supportThreadIds: z.array(z.string()),
	fixtures: z.array(ownedFixture)
});

export type OwnedFixture = z.infer<typeof ownedFixture>;
export type OwnedAttempt = z.infer<typeof ownedAttempt>;
type WithoutToken<F> = F extends unknown ? Omit<F, 'token'> : never;
export type FixtureClaim = WithoutToken<OwnedFixture>;

const runDirectory = (runId: string) => join(root, runId);

/** The run that global setup opened, or undefined when no setup ran in this process tree. */
export function ownedRunId(): string | undefined {
	return process.env[RUN_ID_ENV];
}

/**
 * Opens the run directory before any test writes. Fails while an earlier run's
 * directory remains: that run's cleanup did not finish, and its ledger is the
 * only record of what it left on the backend.
 */
export function beginOwnedTestData(): string {
	if (existsSync(legacyLedger))
		throw new Error(
			'Unfinished E2E cleanup: recover e2e/.auth/owned-test-data.json from an earlier checkout before starting another run'
		);
	const unfinished = existsSync(root)
		? readdirSync(root, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
		: [];
	if (unfinished.length)
		throw new Error(
			`Unfinished E2E cleanup: recover e2e/.auth/owned/${unfinished.join(', ')} before starting another run`
		);
	const runId = randomUUID();
	mkdirSync(runDirectory(runId), { recursive: true });
	// Playwright starts workers after global setup, so they inherit this variable.
	process.env[RUN_ID_ENV] = runId;
	return runId;
}

function recordInWorker(change: (attempt: OwnedAttempt) => void) {
	const runId = ownedRunId();
	const workerIndex = Number(process.env.TEST_WORKER_INDEX);
	if (!runId || !Number.isInteger(workerIndex))
		throw new Error('E2E ownership was not initialized');
	const file = join(runDirectory(runId), `w${workerIndex}.json`);
	const attempt: OwnedAttempt = existsSync(file)
		? ownedAttempt.parse(JSON.parse(readFileSync(file, 'utf8')))
		: {
				runId,
				workerIndex,
				userEmails: [],
				recipientEmails: [],
				supportOwners: [],
				supportThreadIds: [],
				fixtures: []
			};
	change(attempt);
	writeAtomically(file, attempt);
}

// The rename replaces the file in one step, so a reader never sees half a ledger.
function writeAtomically(file: string, value: unknown) {
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(value));
	renameSync(temporary, file);
}

/** Records an E2E email before the request that creates its account or recipient row. */
export function ownTestEmail(
	email: string,
	kind: 'recipientEmails' | 'userEmails' = 'recipientEmails'
) {
	if (!email.endsWith('@e2e.example.com')) throw new Error('Only E2E emails may be owned');
	recordInWorker((attempt) => {
		if (!attempt[kind].includes(email)) attempt[kind].push(email);
	});
}

/** Records an anonymous support ID before the first thread is created for it. */
export function ownAnonymousSupportOwner(anonymousUserId: string) {
	if (!isAnonymousUser(anonymousUserId)) throw new Error('Only anonymous support IDs may be owned');
	recordInWorker((attempt) => {
		if (!attempt.supportOwners.includes(anonymousUserId))
			attempt.supportOwners.push(anonymousUserId);
	});
}

/** Records support thread IDs right after they are created, before any cleanup can hide them. */
export function ownSupportThreads(threadIds: readonly string[]) {
	recordInWorker((attempt) => {
		for (const threadId of threadIds)
			if (!attempt.supportThreadIds.includes(threadId)) attempt.supportThreadIds.push(threadId);
	});
}

/**
 * Records a test-only fixture and returns the token its seed mutation stamps on
 * every row it writes. Call it before the seed.
 */
export function ownFixture(claim: FixtureClaim): string {
	const token = `e2e-fixture-${randomUUID()}`;
	recordInWorker((attempt) => attempt.fixtures.push({ ...claim, token }));
	return token;
}

/**
 * Reads every attempt file of the run, including those of workers that died.
 * Throws when the run's directory is gone: that is lost recovery state, not a
 * run that owned nothing.
 */
export function readOwnedRun(runId: string): OwnedAttempt[] {
	const directory = runDirectory(runId);
	if (!existsSync(directory))
		throw new Error(`E2E ownership ledger e2e/.auth/owned/${runId} is missing`);
	return readdirSync(directory)
		.filter((name) => /^w\d+\.json$/.test(name))
		.map((name) => ownedAttempt.parse(JSON.parse(readFileSync(join(directory, name), 'utf8'))));
}

const teardownState = z.object({
	/** Anonymous IDs plus the user IDs of owned accounts. */
	supportOwners: z.array(z.string()),
	/** Every support thread teardown found under those owners. */
	supportThreadIds: z.array(z.string())
});
export type TeardownState = z.infer<typeof teardownState>;
const teardownFile = (runId: string) => join(runDirectory(runId), 'teardown.json');

/**
 * Keeps what teardown resolved before it deleted anything. A rerun after a
 * failed cleanup can no longer resolve deleted accounts or find threads whose
 * app rows are gone, so it reads their IDs from here.
 */
export function rememberTeardownState(runId: string, state: TeardownState) {
	writeAtomically(teardownFile(runId), state);
}

export function rememberedTeardownState(runId: string): TeardownState {
	const file = teardownFile(runId);
	return existsSync(file)
		? teardownState.parse(JSON.parse(readFileSync(file, 'utf8')))
		: { supportOwners: [], supportThreadIds: [] };
}

/** Removes the run directory once teardown has read back that nothing owned remains. */
export function finishOwnedRun(runId: string) {
	rmSync(runDirectory(runId), { recursive: true, force: true });
}
