import { test } from './utils/test';
import { signInAsTestUser } from './utils/auth';

// Cheaper layers rejected because: a sign-in through the form is the path every
// user takes, from hydrated controls through Better Auth's cookies to the
// authenticated shell. Every other spec in this project starts from the session
// the worker saved, so this is the reported check that the form still gets there.
test.use({ storageState: { cookies: [], origins: [] } });

test('signin with regular user credentials', async ({ page, workerAccounts }) => {
	await signInAsTestUser(page, workerAccounts.user);
});
