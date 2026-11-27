import type { GenericCtx } from '@convex-dev/better-auth';
import { getOAuthProviderApi, oauthProvider } from '@better-auth/oauth-provider';
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint, isAPIError } from 'better-auth/api';
import * as Schema from 'effect/Schema';
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

export const mcpAccess = (provider: ReturnType<typeof createOAuthProvider>) =>
	({
		id: 'mcp-access',
		endpoints: {
			mcpAccessVerify: createAuthEndpoint(
				'/mcp-access/verify',
				{
					method: 'POST',
					body: Schema.toStandardSchemaV1(Schema.Struct({ token: Schema.String })),
					metadata: { SERVER_ONLY: true }
				},
				async (endpointCtx) => {
					try {
						return await getOAuthProviderApi(
							endpointCtx,
							provider.options
						).requireActiveAccessToken(endpointCtx.body.token);
					} catch (error) {
						if (isAPIError(error)) return null;
						throw error;
					}
				}
			)
		}
	}) satisfies BetterAuthPlugin;
