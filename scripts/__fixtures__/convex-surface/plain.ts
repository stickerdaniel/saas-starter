import { mutation, query } from './_generated/server';

export const rename = mutation({ handler: async () => null });
export const read = query({ handler: async () => null });

// Marker-shaped but not a registration: Convex's FilterApi rejects it, and so
// the published surface never carries it. An earlier classifier matched the
// markers itself and counted this, which could satisfy a promise on the
// current side and wave a deletion through.
export const impostor = {
	isConvexFunction: true as const,
	isMutation: true as const,
	isPublic: true as const,
	_handler: () => null
};
