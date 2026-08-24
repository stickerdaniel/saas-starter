const PUBLIC_DISCOVERY_ROUTE_IDS = new Set(['/llms.txt', '/robots.txt', '/sitemap.xml']);

export function isProtectedRoute(pathname: string): boolean {
	return /^\/[a-z]{2}\/app(?:\/|$)/.test(pathname);
}

export function isAdminRoute(pathname: string): boolean {
	return /^\/[a-z]{2}\/admin(?:\/|$)/.test(pathname);
}

function usesPublicAuthSnapshot(routeId: string | null, pathname: string): boolean {
	if (isProtectedRoute(pathname) || isAdminRoute(pathname)) return false;
	if (routeId === '/[[lang]]/(marketing)/pricing') return false;
	return (
		PUBLIC_DISCOVERY_ROUTE_IDS.has(routeId ?? '') ||
		routeId === '/[[lang]]/[...path]' ||
		routeId?.startsWith('/[[lang]]/(marketing)') === true
	);
}

export function shouldUsePublicAuthSnapshot(input: {
	routeId: string | null;
	pathname: string;
	marketingMarkdown: boolean;
}): boolean {
	return input.marketingMarkdown || usesPublicAuthSnapshot(input.routeId, input.pathname);
}
