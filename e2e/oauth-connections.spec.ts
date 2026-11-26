import { expect, type Page } from '@playwright/test';
import { api } from '../src/lib/convex/_generated/api';
import {
	BOTH_SCOPES,
	authorization,
	connectByRequest,
	convexClient,
	convexToken,
	decodeOAuthError,
	fetchMetadata,
	newAccount,
	openConsent,
	refresh,
	registerClient,
	resetRegistrationLimit,
	signInByRequest
} from './utils/oauth';
import { test } from './utils/test';

// Cheaper layers rejected because: revocation has to end a grant across the
// settings tab, the consent page and the token endpoint of one deployment, and
// the owner check runs behind a real session.

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeAll(resetRegistrationLimit);

const firstPage = { paginationOpts: { cursor: null, numItems: 20 } };

async function openAppsTab(page: Page) {
	await page.goto('/app/settings?tab=apps');
	await expect(page.locator('html[data-hydrated]')).toBeAttached();
	return page.getByRole('tabpanel', { name: 'Apps' });
}

const connection = (page: Page, name: string) =>
	page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });

test('a connection shows in the apps tab and Revoke ends it', async ({ page, request }) => {
	const metadata = await fetchMetadata(request);
	const clientId = await registerClient(request, metadata, 'Revoked client');
	await signInByRequest(page, await newAccount('revoke'));
	const tokens = await connectByRequest(page, metadata, clientId);
	const today = new Date().toLocaleDateString('en', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});

	const tab = await openAppsTab(page);
	const block = connection(page, 'Revoked client');
	await expect(block).toHaveCount(1);
	await expect(block.getByRole('definition')).toHaveText(['View and change', today]);

	await block.getByRole('button', { name: 'Revoke access for Revoked client' }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toContainText('Revoke access for Revoked client?');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(block).toHaveCount(1);

	await block.getByRole('button', { name: 'Revoke access for Revoked client' }).click();
	await dialog.getByRole('button', { name: 'Revoke access' }).click();
	await expect(tab.getByText('No connected apps')).toBeVisible();

	await openConsent(page, authorization(metadata, clientId, BOTH_SCOPES));
	await expect(page.getByRole('heading', { name: 'Revoked client wants access' })).toBeVisible();

	const refused = await refresh(request, metadata, clientId, tokens.refresh_token ?? '');
	expect(refused.status()).toBe(400);
	expect(decodeOAuthError(await refused.json()).error).toBe('invalid_grant');
});

test('revoking one client asks the other client for consent again and keeps one grant', async ({
	page,
	request
}) => {
	const metadata = await fetchMetadata(request);
	const clientX = await registerClient(request, metadata, 'Client X');
	const clientY = await registerClient(request, metadata, 'Client Y');
	await signInByRequest(page, await newAccount('replace'));
	await connectByRequest(page, metadata, clientX);
	await connectByRequest(page, metadata, clientY);

	await openAppsTab(page);
	await connection(page, 'Client Y')
		.getByRole('button', { name: 'Revoke access for Client Y' })
		.click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke access' }).click();
	await expect(connection(page, 'Client Y')).toHaveCount(0);

	await openConsent(page, authorization(metadata, clientX, BOTH_SCOPES));
	await expect(page.getByRole('heading', { name: 'Client X wants access' })).toBeVisible();
	await connectByRequest(page, metadata, clientX);

	await openAppsTab(page);
	await expect(connection(page, 'Client X')).toHaveCount(1);
	await expect(page.getByRole('button', { name: /^Revoke access for / })).toHaveCount(1);
});

test("a user cannot revoke another user's connection", async ({ page, request }) => {
	const metadata = await fetchMetadata(request);
	const clientId = await registerClient(request, metadata, 'Owned client');
	await signInByRequest(page, await newAccount('owner'));
	await connectByRequest(page, metadata, clientId);
	const owner = convexClient(await convexToken(page));
	const [consent] = (await owner.query(api.oauth.connections.list, firstPage)).page;
	if (!consent) throw new Error('The owner has no connection');

	await signInByRequest(page, await newAccount('intruder'));
	const intruder = convexClient(await convexToken(page));
	expect(
		await intruder.mutation(api.oauth.connections.revoke, { consentId: consent.consentId })
	).toEqual({ revoked: false });

	const after = await owner.query(api.oauth.connections.list, firstPage);
	expect(after.page.map(({ consentId }) => consentId)).toEqual([consent.consentId]);
});
