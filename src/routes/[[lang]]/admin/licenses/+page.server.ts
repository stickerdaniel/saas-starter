export const load = async () => {
	// Deferred: Kit analyses routes before the client build has collected notices,
	// so an eager import of the generated catalogue fails the build.
	const { default: catalogue } = await import('virtual:third-party-licenses/server');
	return { entries: catalogue?.entries ?? null };
};
