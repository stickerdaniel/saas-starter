/**
 * Shared email state across auth pages (sign-in, sign-up, forgot-password)
 * This improves UX by remembering the email when switching between auth flows
 */
class AuthFlowManager {
	email = $state('');
}

export const authFlow = new AuthFlowManager();
