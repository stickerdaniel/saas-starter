/** Public pages receive their font bytes with the document. */
export function criticalFontScope(routeId: string | null | undefined) {
	if (routeId === '/[[lang]]/(marketing)') return 'home';
	if (routeId?.startsWith('/[[lang]]/(marketing)/') || routeId?.startsWith('/[[lang]]/(auth)/')) {
		return 'public';
	}
}
