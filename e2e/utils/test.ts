// The `test` every E2E spec imports; ESLint rejects the raw Playwright runner.
//
// Client errors. A test attempt fails when a page it drives raises a client
// error the test did not allow: an uncaught exception (`pageerror`), or an
// error SvelteKit's client `handleError` reports through the
// `__e2eReportClientError` binding (src/lib/monitoring/e2e-client-error.ts).
//
// The `context` fixture is instrumented only when a test asks for it, so
// request-only tests still never launch a browser. A context the test builds
// itself with `browser.newContext()` goes through `guardClientErrors` before
// its first page.
//
// A test that provokes an error on purpose names it, with a reason:
//
//   // The offline banner is the behaviour under test.
//   test.use({ allowedClientErrors: [/Failed to fetch/] });
//
// e2e/public-client-error-guard.spec.ts proves each channel, the allowance and
// the browser-free request path.
//
// Worker accounts. A project that sets `signedInAs` gives each worker process
// its own user ("E2E Test User") and admin, so no two workers share a session,
// an upload budget or a support history. The worker creates both on first use,
// signs each in through the form and saves the browser state; every context then
// starts signed in as the `signedInAs` account. A spec reads the credentials
// from `workerAccounts`, and an explicit `test.use({ storageState })` still
// wins, so anonymous specs stay anonymous:
//
//   test.use({ storageState: { cookies: [], origins: [] } });
//   test('...', async ({ page, workerAccounts }) => {
//     await signInAsTestUser(page, workerAccounts.user);
//   });
//
// Projects without `signedInAs` (public, no-auth, signout) never provision.

import {
	test as base,
	expect,
	type Browser,
	type BrowserContext,
	type Page,
	type WorkerInfo
} from '@playwright/test';
import { createTestAccount, signInAsTestUser } from './auth';
import { ownedRunId, ownTestEmail } from './owned-test-data';
import type { AccountRole, WorkerAccount, WorkerAccounts } from './types';

type ClientErrorFixtures = {
	/** Messages of client errors this test provokes on purpose. */
	allowedClientErrors: RegExp[];
	/** Messages collected during the current attempt, in arrival order. */
	clientErrors: string[];
};

export type WorkerAccountOptions = {
	/** The worker account every context starts as; null provisions nothing. */
	signedInAs: AccountRole | null;
};

type WorkerAccountFixtures = WorkerAccountOptions & {
	/** Both accounts when `signedInAs` is set, otherwise null. */
	provisionedAccounts: WorkerAccounts | null;
	/** This worker's user and admin; only projects that set `signedInAs` have them. */
	workerAccounts: WorkerAccounts;
};

// A worker runs one test at a time, so the running attempt's collector can sit
// in module state, where `guardClientErrors` reaches it without a fixture.
let activeCollector: string[] | null = null;

async function collectInto(context: BrowserContext, collector: string[]): Promise<void> {
	await context.exposeBinding('__e2eReportClientError', (_source, message: string) => {
		collector.push(message);
	});
	const listen = (page: Page) => page.on('pageerror', (error) => collector.push(error.message));
	context.pages().forEach(listen);
	context.on('page', listen);
}

/**
 * Feeds the client errors of a context the test created itself into the
 * running attempt's guard. Call it on the new context before its first page.
 */
export async function guardClientErrors(context: BrowserContext): Promise<BrowserContext> {
	if (!activeCollector) {
		throw new Error('guardClientErrors needs a running test; beforeAll and global setup have none');
	}
	await collectInto(context, activeCollector);
	return context;
}

/**
 * Signs one account in through the form and saves its browser state. No test
 * attempt runs yet, so the context carries its own client-error collector and
 * the sign-in fails when any page error reached it.
 */
async function saveSignedInState(browser: Browser, account: WorkerAccount, workerInfo: WorkerInfo) {
	const { baseURL, extraHTTPHeaders } = workerInfo.project.use;
	const errors: string[] = [];
	const context = await browser.newContext({
		baseURL,
		extraHTTPHeaders,
		storageState: { cookies: [], origins: [] }
	});
	try {
		await collectInto(context, errors);
		await signInAsTestUser(await context.newPage(), account);
		await context.storageState({ path: account.storageState });
	} finally {
		await context.close();
	}
	expect(errors, `Client errors while signing in ${account.email}`).toEqual([]);
}

async function provisionWorkerAccounts(
	browser: Browser,
	workerInfo: WorkerInfo
): Promise<WorkerAccounts> {
	const runId = ownedRunId();
	if (!runId) throw new Error('Worker accounts need the run that global setup opens');
	const account = (role: AccountRole, name: string): WorkerAccount => ({
		email: `test-${role}-${runId}-w${workerInfo.workerIndex}@e2e.example.com`,
		password: 'TestPassword123!',
		name,
		storageState: `e2e/.auth/w${workerInfo.workerIndex}-${role}.json`
	});
	// upgrade-checkout-confirmation.spec.ts expects the user's display name.
	const accounts: WorkerAccounts = {
		user: account('user', 'E2E Test User'),
		admin: account('admin', 'E2E Test Admin')
	};
	// Both emails are in the ledger before the first request, so a worker killed
	// at any point after this still leaves them for global teardown.
	ownTestEmail(accounts.user.email, 'userEmails');
	ownTestEmail(accounts.admin.email, 'userEmails');
	ownTestEmail(accounts.admin.email);
	await createTestAccount(accounts.user);
	await createTestAccount(accounts.admin, 'admin');
	await saveSignedInState(browser, accounts.user, workerInfo);
	await saveSignedInState(browser, accounts.admin, workerInfo);
	return accounts;
}

export const test = base.extend<ClientErrorFixtures, WorkerAccountFixtures>({
	allowedClientErrors: [[], { option: true }],
	clientErrors: [
		async ({ allowedClientErrors }, use) => {
			const collector: string[] = [];
			activeCollector = collector;
			await use(collector);
			activeCollector = null;

			const unexpected = collector.filter(
				(message) => !allowedClientErrors.some((pattern) => pattern.test(message))
			);
			expect(
				unexpected,
				'Unexpected client errors. Fix them, or allow a deliberately provoked one with allowedClientErrors.'
			).toEqual([]);
		},
		{ auto: true }
	],
	// Depends on `clientErrors`, so Playwright tears the context down first and
	// errors raised while its pages close still reach the check above.
	context: async ({ context, clientErrors }, use) => {
		await collectInto(context, clientErrors);
		await use(context);
	},
	signedInAs: [null, { scope: 'worker', option: true }],
	provisionedAccounts: [
		// Every test resolves this, request-only and public ones included, so it
		// launches a browser of its own only when it provisions, instead of
		// depending on the worker's `browser` fixture.
		async ({ playwright, browserName, signedInAs }, use, workerInfo) => {
			if (!signedInAs) return await use(null);
			// Without arguments, launch uses the project's launch options, as the
			// `browser` fixture does.
			const browser = await playwright[browserName].launch();
			let accounts: WorkerAccounts;
			try {
				accounts = await provisionWorkerAccounts(browser, workerInfo);
			} finally {
				await browser.close();
			}
			await use(accounts);
		},
		// Two sign-ups and two form sign-ins. Locally the first sign-in pays the
		// cold route compile: observed 2026-10-15, the sign-in HTML arrived after
		// 25.7 s, and /app compiles next. Each sign-in gets the 90 s it had as a
		// setup project.
		{ scope: 'worker', timeout: 180_000 }
	],
	workerAccounts: [
		async ({ provisionedAccounts }, use) => {
			if (!provisionedAccounts)
				throw new Error('workerAccounts exists only in projects that set signedInAs');
			await use(provisionedAccounts);
		},
		{ scope: 'worker' }
	],
	// Every test resolves this through Playwright's context options, so the
	// `signedInAs` projects provision on their first test. A spec's own
	// `test.use({ storageState })` replaces this fixture and stays anonymous.
	storageState: async ({ storageState, signedInAs, provisionedAccounts }, use) => {
		await use(
			signedInAs && provisionedAccounts
				? provisionedAccounts[signedInAs].storageState
				: storageState
		);
	}
});
