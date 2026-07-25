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
/**
 * Whether the server has confirmed a stop during this document load.
 *
 * Module scope, not per instance: the stale session lives in Better Auth's
 * global store, so an instance-local latch dies with the first client-side
 * navigation. Leaving the app shell for the marketing shell would build a fresh
 * state, read the same stale session, and put the dead Stop control back.
 *
 * A full document load resets this, which is exactly the intended lifetime: a
 * new impersonation always starts with one (see the admin users table).
 *
 * Plain `let`, written only from `stop()` — a browser-only path — so no SSR
 * request can ever observe another request's value.
 */
let stopConfirmedThisLoad = false;

export class ImpersonationState {
	#impersonating = $state(false);
	#resolved = $state(false);

	/** True once the session carries `impersonatedBy`. False while unresolved. */
	get isImpersonating(): boolean {
		return this.#impersonating;
	}

	/**
	 * Whether a log out control may be shown.
	 *
	 * A plain `!isImpersonating` would conflate "not impersonating" with "session
	 * not loaded yet", and the session starts out pending with no data. On an SSR
	 * authenticated page the shell renders before the first session read resolves,
	 * so the log out control would be live during that window — exactly the trap
	 * this state exists to prevent. Gate on a resolved session instead.
	 *
	 * A failed session read counts as resolved: the alternative is a surface with
	 * no way out at all, and Better Auth clears the data on a 401 so the shell
	 * falls back to its signed-out rendering anyway.
	 */
	get canSignOut(): boolean {
		return this.#resolved && !this.#impersonating;
	}

	/**
	 * Subscribes to the live session. Call during component init so the
	 * subscription is torn down with the component.
	 */
	constructor() {
		$effect(() => {
			return authClient.useSession().subscribe((s) => {
				// Once the server has confirmed a stop, any session still carrying
				// impersonatedBy is stale: Better Auth writes every completed refresh
				// into its store unconditionally, with no generation check, and neither
				// the stop nor the refresh matches its session-signal listeners, so the
				// store keeps serving a session the server already deleted.
				if (!stopConfirmedThisLoad) {
					this.#impersonating = !!s.data?.session?.impersonatedBy;
				}
				// Stays true across refetches that already hold data, so a background
				// session refresh never flickers the control back to its pending state.
				this.#resolved = !s.isPending;
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
			// The server has stopped the impersonation: the target's session is gone
			// and the admin session cookie is live again. Record that before the
			// refresh, because neither this call nor the refresh below matches Better
			// Auth's session-signal listeners, so the store keeps serving the stale
			// impersonated session. Leaving the flag set would leave Stop as the only
			// control on a session that can no longer be stopped, and every further
			// click would fail with "You are not impersonating anyone".
			stopConfirmedThisLoad = true;
			this.#impersonating = false;

			// Better Auth's convex plugin does not re-mint the SSR JWT cookie on stop.
			// Force a session read so the server issues a fresh convex_jwt for the
			// admin before we navigate, otherwise SSR resolves the still-alive
			// impersonated token. The fetch resolves errors as { error } instead of
			// throwing, so the catch below would miss a failed refresh and navigate on
			// the target's identity. Log out stays available as the exit here, and it
			// is safe now: it ends the admin's own restored session, not the target's.
			const refreshed = await authClient.getSession({ query: { disableCookieCache: true } });
			if (refreshed.error || !refreshed.data) {
				toast.error(t('app.user_menu.impersonation_stop_failed'));
				return;
			}
			toast.success(t('app.user_menu.impersonation_stopped'));
			// Full document navigation, not a client-side goto: the app must boot with
			// the fresh JWT and new Convex subscriptions bound to the admin identity.
			window.location.assign(localizedHref('/admin/users'));
		} catch {
			toast.error(t('app.user_menu.impersonation_stop_failed'));
		}
	}
}
