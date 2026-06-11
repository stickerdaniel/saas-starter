import { Context } from 'runed';

/**
 * Shared email state across auth pages (sign-in, sign-up, forgot-password)
 * This improves UX by remembering the email when switching between auth flows.
 *
 * Provided via context from the (auth) layout so each SSR request gets its own
 * instance instead of sharing a module-scope singleton across requests.
 */
export class AuthFlowManager {
	email = $state('');
}

export const authFlowContext = new Context<AuthFlowManager>('auth-flow');
