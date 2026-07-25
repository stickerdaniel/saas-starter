import { authClient } from '$lib/auth-client';
import { localizedHref } from '$lib/utils/i18n';
import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
import { toast } from 'svelte-sonner';

/**
 * Live impersonation state plus the exit action, shared by every shell that
 * offers a session control.
 *
 * While an admin impersonates a user, Better Auth's `signOut` deletes the
 * impersonated session and its cookie, and never redeems the `admin_session`
 * cookie that `stopImpersonating` needs. A plain log out therefore strands the
 * admin fully signed out and destroys the target's session as a side effect, so
 * every surface with a log out control has to swap it for Stop Impersonating.
 *
 * Instantiated per component — never a module-level singleton, which would leak
 * across SSR requests.
 */
export class ImpersonationState {
	/** True while the current session carries `impersonatedBy`. */
	isImpersonating = $state(false);

	/**
	 * Subscribes to the live session. Call during component init so the
	 * subscription is torn down with the component.
	 */
	constructor() {
		$effect(() => {
			return authClient.useSession().subscribe((s) => {
				this.isImpersonating = !!s.data?.session?.impersonatedBy;
			});
		});
	}

	/**
	 * Restores the admin session and navigates back to the users table.
	 *
	 * @param t - Tolgee translate function ($t from getTranslate())
	 */
	async stop(t: (key: string) => string): Promise<void> {
		haptic.trigger('warning');
		try {
			const result = await authClient.admin.stopImpersonating();
			if (result.error) {
				toast.error(t('app.user_menu.impersonation_stop_failed'));
				return;
			}
			toast.success(t('app.user_menu.impersonation_stopped'));
			// Stopping restored the admin session cookie, but Better Auth's convex
			// plugin does not re-mint the SSR JWT cookie on stop. Force a session read
			// so the server issues a fresh convex_jwt for the admin before we navigate,
			// otherwise SSR resolves the still-alive impersonated token.
			await authClient.getSession({ query: { disableCookieCache: true } });
			// Full document navigation, not a client-side goto: the app must boot with
			// the fresh JWT and new Convex subscriptions bound to the admin identity.
			window.location.assign(localizedHref('/admin/users'));
		} catch {
			toast.error(t('app.user_menu.impersonation_stop_failed'));
		}
	}
}
