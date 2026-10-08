import { Context } from 'runed';
import { authClient } from '#lib/auth-client.js';
import { localizedHref } from '#lib/utils/i18n.js';
import { authPageURL } from '#lib/utils/url.js';
import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
import { clearPersistedChatState } from '#lib/chat/core/chat-persisted-state.ts';
import {
	clearInvestigationReturn,
	readInvestigationReturn
} from '#lib/admin/investigation-return.js';
import { toast } from 'svelte-sonner';
import { duringAuthChange } from '#lib/analytics/client.js';

/**
 * Live impersonation state plus the exit actions, shared by every shell that
 * offers a session control.
 *
 * While an admin impersonates a user, Better Auth's `signOut` deletes the
 * impersonated session and its cookie, and never redeems the `admin_session`
 * cookie that `stopImpersonating` needs. A plain log out therefore strands the
 * admin fully signed out and destroys the target's session as a side effect, so
 * every surface with a log out control has to swap it for Stop Impersonating.
 *
 * One instance per document, built by the root layout and read through
 * `impersonationContext`: the investigation bar, the user menu and the
 * marketing header have to agree on whether an exit is in flight, or a second
 * control could start a second stop. Never a module-level singleton, which
 * would leak across SSR requests.
 */
/**
 * Whether the server has confirmed a stop during this document load.
 *
 * After an acknowledged stop, Better Auth's global store can still deliver a
 * late session snapshot that carries `impersonatedBy`. The latch makes every
 * later snapshot in this document load read as not impersonating, so a Stop
 * control never comes back for a session the server has already ended.
 *
 * A full document load resets this, which is exactly the intended lifetime: a
 * new impersonation always starts with one (see `admin/impersonate-user.ts`).
 *
 * Plain `let`, written only from `stop()` — a browser-only path — so no SSR
 * request can ever observe another request's value.
 */
let stopConfirmedThisLoad = false;

/**
 * Where leaving an investigation stands.
 *
 * - `stopping`: a stop or its follow-up session read is in flight.
 * - `returnPending`: the server ended the impersonation, but the admin session
 *   could not be read back, so navigating now would boot on a stale identity.
 * - `recovery`: the server could not restore the admin session at all.
 */
export type ImpersonationExit = 'idle' | 'stopping' | 'returnPending' | 'recovery';

type Translate = (key: string) => string;
type UploadGuard = { suspendOnce(): void } | null;

/** The person being viewed, as the impersonated session reports them. */
export type ViewedUser = { name: string; email: string };

/**
 * A stop the server refused because the admin session is gone: the
 * impersonated session expired (401), or `admin_session` is missing or no
 * longer matches (Better Auth's admin plugin, `/admin/stop-impersonating`).
 * Retrying cannot help; only signing in again can.
 */
function adminSessionLost(error: { status?: number; message?: string }): boolean {
	return (
		error.status === 401 ||
		(error.status === 500 && error.message === 'Failed to find admin session')
	);
}

export class ImpersonationState {
	#impersonating = $state(false);
	#resolved = $state(false);
	#viewedUser = $state<ViewedUser | null>(null);
	#exit = $state<ImpersonationExit>('idle');
	// One exit action at a time across every control: a second stop would meet
	// "You are not impersonating anyone" and report a failure for a stop that
	// worked.
	#pending = $state(false);
	#activeUploads: UploadGuard;

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
	 *
	 * Also false while an exit is under way: an ordinary log out there would skip
	 * the return to the admin page and the upload and chat cleanup of the exit.
	 */
	get canSignOut(): boolean {
		return this.#resolved && !this.#impersonating && this.#exit === 'idle';
	}

	get exit(): ImpersonationExit {
		return this.#exit;
	}

	get pending(): boolean {
		return this.#pending;
	}

	/** The impersonated user, kept through an exit so the notice can still name them. */
	get viewedUser(): ViewedUser | null {
		return this.#viewedUser;
	}

	/**
	 * Subscribes to the live session. Call during component init so the
	 * subscription is torn down with the component.
	 *
	 * @param activeUploads - Consulted immediately before every navigation that
	 * leaves the investigation. By then the session belongs to someone else, so
	 * an upload that stopped it would leave the target's page on screen under
	 * the wrong identity.
	 */
	constructor(activeUploads: UploadGuard = null) {
		this.#activeUploads = activeUploads;
		$effect(() => {
			return authClient.useSession().subscribe((s) => {
				// Once the server has confirmed a stop, any session still carrying
				// impersonatedBy is stale: Better Auth writes every completed refresh
				// into its store unconditionally, with no generation check, so a read
				// that started before the stop can land after it. Better Auth
				// registers start and stop as session-signal actions
				// (plugins/admin/client.mjs, atomListeners); the explicit get-session
				// read after a stop is not one.
				if (!stopConfirmedThisLoad) {
					const impersonating = !!s.data?.session?.impersonatedBy;
					this.#impersonating = impersonating;
					if (impersonating && s.data) {
						this.#viewedUser = { name: s.data.user.name, email: s.data.user.email };
					}
				}
				// Stays true across refetches that already hold data, so a background
				// session refresh never flickers the control back to its pending state.
				this.#resolved = !s.isPending;
			});
		});
	}

	/**
	 * Restores the admin session and navigates back to the admin page the
	 * impersonation started from.
	 *
	 * @param t - Tolgee translate function ($t from getTranslate())
	 */
	async stop(t: Translate): Promise<void> {
		// After an acknowledged stop only the return is left to retry.
		if (this.#pending || this.#exit === 'returnPending') return;
		this.#pending = true;
		const previous = this.#exit;
		this.#exit = 'stopping';
		haptic.trigger('warning');

		let result: Awaited<ReturnType<typeof authClient.admin.stopImpersonating>>;
		try {
			result = await duringAuthChange(
				() => authClient.admin.stopImpersonating(),
				(result) => !result.error
			);
		} catch {
			this.#settle(previous);
			toast.error(t('app.user_menu.impersonation_stop_failed'));
			return;
		}
		if (result.error) {
			if (adminSessionLost(result.error)) {
				this.#settle('recovery');
				return;
			}
			this.#settle(previous);
			toast.error(t('app.user_menu.impersonation_stop_failed'));
			return;
		}

		// The server has stopped the impersonation: the target's session is gone
		// and the admin session cookie is live again. Record that before the
		// refresh, because the store can still serve the stale impersonated
		// session afterwards (see the subscription above). Leaving the flag set
		// would leave Stop as the only control on a session that can no longer be
		// stopped, and every further click would fail with "You are not
		// impersonating anyone".
		stopConfirmedThisLoad = true;
		this.#impersonating = false;
		await this.#refreshAndLeave(t);
	}

	/**
	 * After a stop the server acknowledged: read the admin session again and
	 * leave. Never stops again, because the impersonation is already over.
	 */
	async retryReturn(t: Translate): Promise<void> {
		if (this.#pending || this.#exit !== 'returnPending') return;
		this.#pending = true;
		await this.#refreshAndLeave(t);
	}

	/**
	 * Sign this browser out and send it to sign-in, which then continues to the
	 * admin page the investigation started from.
	 */
	async signInAgain(): Promise<void> {
		if (this.#pending) return;
		this.#pending = true;
		try {
			const result = await duringAuthChange(
				() => authClient.signOut(),
				(result) => !result.error
			);
			if (result.error) {
				this.#pending = false;
				return;
			}
		} catch {
			this.#pending = false;
			return;
		}
		this.#activeUploads?.suspendOnce();
		clearPersistedChatState();
		const destination = authPageURL(localizedHref('/signin'), this.#returnTarget());
		clearInvestigationReturn();
		window.location.assign(destination);
	}

	async #refreshAndLeave(t: Translate): Promise<void> {
		// Better Auth's convex plugin does not re-mint the SSR JWT cookie on stop.
		// Force a session read so the server issues a fresh convex_jwt for the
		// admin before we navigate, otherwise SSR resolves the still-alive
		// impersonated token. The fetch resolves errors as { error } instead of
		// throwing, so both shapes of failure have to be caught here. Both leave
		// the admin a retry, because navigating now would boot on the target's
		// identity.
		try {
			const refreshed = await authClient.getSession({ query: { disableCookieCache: true } });
			if (refreshed.error || !refreshed.data) {
				this.#settle('returnPending');
				return;
			}
		} catch {
			this.#settle('returnPending');
			return;
		}
		toast.success(t('app.user_menu.impersonation_stopped'));
		// Full document navigation, not a client-side goto: the app must boot with
		// the fresh JWT and new Convex subscriptions bound to the admin identity.
		this.#activeUploads?.suspendOnce();
		// Whatever the admin wrote while signed in as someone else stays with
		// that session and does not follow them back to their own.
		clearPersistedChatState();
		const destination = this.#returnTarget();
		clearInvestigationReturn();
		// `pending` stays held: the document is leaving, and a second click during
		// unload would stop an impersonation that no longer exists.
		window.location.assign(destination);
	}

	#returnTarget(): string {
		return readInvestigationReturn() ?? localizedHref('/admin/users');
	}

	#settle(exit: ImpersonationExit): void {
		this.#exit = exit;
		this.#pending = false;
	}
}

export const impersonationContext = new Context<ImpersonationState>('impersonation');
