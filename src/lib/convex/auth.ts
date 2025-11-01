import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials';
import { Password } from '@convex-dev/auth/providers/Password';
import GitHub from '@auth/core/providers/github';
import Google from '@auth/core/providers/google';
import { convexAuth } from '@convex-dev/auth/server';
import { internal } from './_generated/api';
import { ResendOTP } from './auth/ResendOTP';

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
	providers: [
		Password({ verify: ResendOTP }),
		GitHub,
		Google,
		ConvexCredentials({
			id: 'secret',
			authorize: async (params, ctx) => {
				const secret = params.secret;
				if (process.env.AUTH_E2E_TEST_SECRET && secret === process.env.AUTH_E2E_TEST_SECRET) {
					const user = await ctx.runQuery(internal.tests.getTestUser);
					return { userId: user!._id };
				}
				throw new Error('Invalid secret');
			}
		})
	],
	callbacks: {
		async redirect({ redirectTo }) {
			console.log('[AUTH CALLBACK] Redirect called with:', redirectTo);

			// Get the site URL from environment
			const siteUrl = process.env.SITE_URL ?? '/';

			// Validate redirectTo for security (prevent open redirects)
			// Only allow relative URLs (starting with /) to prevent phishing attacks
			if (redirectTo && typeof redirectTo === 'string' && redirectTo.startsWith('/')) {
				const absoluteUrl = `${siteUrl}${redirectTo}`;
				console.log('[AUTH CALLBACK] Returning absolute URL:', absoluteUrl);
				return absoluteUrl;
			}

			console.log('[AUTH CALLBACK] Returning fallback:', siteUrl);
			return siteUrl;
		}
	}
});
