/**
 * The Convex registration builders the local rules recognise by name.
 * `src/lib/confect/functions.test.ts` checks that CUSTOM_REGISTRARS names every
 * export of `src/lib/confect/functions.ts`.
 */

/** Convex's own builders from `_generated/server`. */
export const RAW_REGISTRARS = [
	'query',
	'mutation',
	'action',
	'internalQuery',
	'internalMutation',
	'internalAction'
];

/** The custom builders `src/lib/confect/functions.ts` exports. */
export const CUSTOM_REGISTRARS = ['authedQuery', 'authedMutation', 'adminQuery', 'adminMutation'];

export const CONFECT_CONSTRUCTORS = {
	'@confect/core': ['FunctionSpec', 'GroupSpec'],
	'@confect/server': ['FunctionImpl', 'GroupImpl']
};

export const CONFECT_NATIVE_SPECS = [
	'publicQuery',
	'internalQuery',
	'publicPaginatedQuery',
	'internalPaginatedQuery',
	'publicMutation',
	'internalMutation',
	'publicAction',
	'internalAction',
	'publicNodeAction',
	'internalNodeAction'
];

export const CONFECT_PLAIN_SPECS = [
	'convexPublicQuery',
	'convexInternalQuery',
	'convexPublicMutation',
	'convexInternalMutation',
	'convexPublicAction',
	'convexInternalAction',
	'convexPublicNodeAction',
	'convexInternalNodeAction'
];
