/** The Convex registration builders the local rules recognise by name. */

/** Convex's own builders from `_generated/server`. */
export const RAW_REGISTRARS = [
	'query',
	'mutation',
	'action',
	'internalQuery',
	'internalMutation',
	'internalAction'
];

export const GENERIC_REGISTRARS = [
	'queryGeneric',
	'mutationGeneric',
	'actionGeneric',
	'internalQueryGeneric',
	'internalMutationGeneric',
	'internalActionGeneric',
	'httpActionGeneric'
];

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

export const CONFECT_LIBRARY_FUNCTIONS = {
	'authComponent.triggersApi()': ['auth:onCreate', 'auth:onUpdate', 'auth:onDelete'],
	'autumn.api()': [
		'autumn:attach',
		'autumn:billingPortal',
		'autumn:cancel',
		'autumn:check',
		'autumn:checkout',
		'autumn:createCustomer',
		'autumn:createEntity',
		'autumn:createReferralCode',
		'autumn:getEntity',
		'autumn:listProducts',
		'autumn:query',
		'autumn:redeemReferralCode',
		'autumn:setupPayment',
		'autumn:track',
		'autumn:usage'
	]
};

export const PLAIN_HTTP_ROUTES = {
	'/files/inline':
		'A Confect HTTP handler cannot call the files-control mutation consumeDownloadGrantForUrl, which resolves the grant.',
	'/resend-webhook':
		'resend.handleResendEventWebhook takes the Convex action context and the request as they arrive.'
};

export const PLAIN_REGISTRATION_PATHS = {
	'**/*.test.ts':
		'Tests register harness functions, such as mutationGeneric in profileImageUpload.test.ts.',
	'**/__tests__/**':
		'Tests register harness functions, such as mutationGeneric in profileImageUpload.test.ts.'
};
