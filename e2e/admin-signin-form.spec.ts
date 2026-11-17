import { test } from './utils/test';
import { signInAsTestUser } from './utils/auth';

// Cheaper layers rejected because: an admin signs in through the same form, and
// the authenticated shell must load for the admin role too. Every other admin
// spec starts from the session the worker saved, so this is the reported check
// that the form still gets an admin there.
test.use({ storageState: { cookies: [], origins: [] } });

test('signin with admin user credentials', async ({ page, workerAccounts }) => {
	await signInAsTestUser(page, workerAccounts.admin);
});
