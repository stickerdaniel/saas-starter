import type { GenericCtx } from '@convex-dev/better-auth';
import { oauthProvider } from '@better-auth/oauth-provider';
import { internal } from '../../convex/_generated/api';
import type { DataModel } from '../../convex/_generated/dataModel';
import { currentEpoch } from './grants';
import { CONSENT_PAGE_PATH, mcpAudiences, mcpResourceUrl, OAUTH_SCOPES } from './resource';

const readEpoch = (ctx: GenericCtx<DataModel>, userId: string): Promise<number> =>
	'db' in ctx
		? currentEpoch(ctx.db, userId)
		: ctx.runQuery(internal.oauth.connections.epoch, { userId });

export const oauthProviderOptions = (ctx: GenericCtx<DataModel>) => ({
	loginPage: '/signin',
	consentPage: CONSENT_PAGE_PATH,
	disableJwtPlugin: true,
	scopes: [...OAUTH_SCOPES],
	allowDynamicClientRegistration: true,
	allowUnauthenticatedClientRegistration: true,
	clientRegistrationDefaultApplicationType: 'infer' as const,
	allowPublicClientPrelogin: true,
	resources: mcpAudiences(),
	clientRegistrationDefaultResources: [mcpResourceUrl()],
	postLogin: {
		page: CONSENT_PAGE_PATH,
		shouldRedirect: () => false,
		consentReferenceId: async ({ user }: { user: { id: string } }) =>
			String(await readEpoch(ctx, user.id))
	},
	customAccessTokenClaims: ({ referenceId }: { referenceId?: string }) =>
		referenceId === undefined ? {} : { grant: referenceId }
});

export const createOAuthProvider = (ctx: GenericCtx<DataModel>) =>
	oauthProvider(oauthProviderOptions(ctx));
