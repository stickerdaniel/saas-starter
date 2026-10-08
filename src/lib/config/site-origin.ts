import { PUBLIC_SITE_URL } from '$app/env/public';
import { resolveConfiguredSiteOrigin } from './origin';

export function resolveSiteOrigin(requestOrigin: string): string {
	return resolveConfiguredSiteOrigin(PUBLIC_SITE_URL || undefined, requestOrigin);
}
