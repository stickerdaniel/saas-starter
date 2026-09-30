/**
 * Exact browser storage names the pinned posthog-js release uses for one project,
 * plus the app's own identity-period stamp. Only the main persistence entry uses the
 * SDK's transformed token (`posthog-persistence.ts` parseName); session keys and the
 * consent marker use the raw token.
 */
export function analyticsStorageKeys(token: string) {
	const transformed = token.replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ');
	return {
		main: `ph_${transformed}_posthog`,
		windowId: `ph_${token}_window_id`,
		primaryWindow: `ph_${token}_primary_window_exists`,
		sessionRegistered: `ph_${token}_session_registered_properties`,
		/** Which consent period the persisted identity belongs to. */
		periodStamp: `analytics_identity_grant_${token}`,
		/** The SDK's own consent marker. Never deleted by the app: see clearAnalyticsIdentity. */
		consentMarker: `__ph_opt_in_out_${token}`
	};
}

export interface BrowserStores {
	localStorage: Storage | undefined;
	sessionStorage: Storage | undefined;
	document: Pick<Document, 'cookie'> | undefined;
	hostname: string;
	secure: boolean;
}

function removeItem(storage: Storage | undefined, key: string): void {
	try {
		storage?.removeItem(key);
	} catch {
		// Storage access can throw in hardened browsers; nothing to clean there.
	}
}

/**
 * Expires a Path=/ cookie without guessing the registrable domain: once host-only,
 * then for the host and every parent label. Browsers ignore invalid domains.
 */
function expireCookie(stores: BrowserStores, name: string): void {
	if (!stores.document) return;
	const secure = stores.secure ? '; Secure' : '';
	const labels = stores.hostname.split('.');
	const domains = [undefined, ...labels.map((_, index) => labels.slice(index).join('.'))];
	for (const domain of domains) {
		try {
			stores.document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ''}${secure}`;
		} catch {
			// A rejected cookie write leaves nothing behind to clean.
		}
	}
}

/**
 * Removes the stored anonymous identity of one project: the SDK persistence, its
 * per-tab session keys, the period stamp, and a legacy persistence cookie from older
 * template versions.
 *
 * The SDK consent marker stays. With rejecting defaults a missing marker is harmless,
 * but another open tab's SDK reads it, and keeping it avoids surprising that tab.
 */
export function clearAnalyticsIdentity(token: string, stores: BrowserStores): void {
	const keys = analyticsStorageKeys(token);
	for (const storage of [stores.localStorage, stores.sessionStorage]) {
		for (const key of [
			keys.main,
			keys.windowId,
			keys.primaryWindow,
			keys.sessionRegistered,
			keys.periodStamp
		]) {
			removeItem(storage, key);
		}
	}
	expireCookie(stores, keys.main);
}

/** A write that reads back and removes cleanly; otherwise the store is not durable. */
export function isStorageUsable(getStorage: () => Storage | undefined): boolean {
	const probe = '__analytics_storage_probe__';
	try {
		const storage = getStorage();
		if (!storage) return false;
		storage.setItem(probe, probe);
		const readBack = storage.getItem(probe);
		storage.removeItem(probe);
		return readBack === probe && storage.getItem(probe) === null;
	} catch {
		return false;
	}
}
