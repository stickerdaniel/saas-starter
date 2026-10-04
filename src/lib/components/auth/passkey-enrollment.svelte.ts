import { fromStore } from 'svelte/store';
import { getTranslate } from '@tolgee/svelte';
import { useConvexClient } from 'convex-svelte';
import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
import { toast } from 'svelte-sonner';
import { authClient } from '$lib/auth-client';
import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
import { pendingPasskeyNudge } from '$lib/hooks/passkey-nudge.svelte.ts';
import type { PendingOAuthProvider } from '$lib/hooks/last-auth-method.svelte.ts';
import { getPasskeyDevice } from '$lib/utils/passkey-device';
import { addPasskey, suggestPasskeyName } from './passkey-registration';
import {
	claimPasskeyNudge,
	deferPasskeyNudge,
	type PasskeyNudgeUser
} from '$lib/utils/passkey-nudge';

/**
 * The state behind a passkey offer, shared by the setup page and the sidebar card.
 * Create it during component initialisation: it reads context and owns an effect.
 */
export class PasskeyEnrollment {
	#user: () => PasskeyNudgeUser | null;
	#oncontinue: () => void;
	#client = useConvexClient();
	#t = fromStore(getTranslate().t);
	#editedName = $state<string>();

	busy = $state(false);
	/** Translation key of the last failure, empty when there is none. */
	error = $state('');

	readonly suggestedName = $derived.by(() => {
		const user = this.#user();
		if (!user) return '';
		return suggestPasskeyName(this.#t.current, user.name, getPasskeyDevice(navigator));
	});

	constructor(user: () => PasskeyNudgeUser | null, oncontinue: () => void) {
		this.#user = user;
		this.#oncontinue = oncontinue;
		const session = fromStore(authClient.useSession());
		// Another account signed in elsewhere in this browser: the offer is not theirs.
		$effect(() => {
			const data = session.current.data;
			const user = this.#user();
			if (data && user && data.session.id !== user.sessionId) this.#oncontinue();
		});
	}

	get name() {
		return this.#editedName ?? this.suggestedName;
	}

	set name(value: string) {
		this.#editedName = value;
	}

	/**
	 * Resolves true only once the server has stored the new passkey, and confirms it with a
	 * toast. The form stays busy after success while its owner moves on.
	 */
	async create(): Promise<boolean> {
		const user = this.#user();
		if (this.busy || !user) return false;
		this.busy = true;
		this.error = '';
		let created = false;
		try {
			const session = await authClient.getSession({
				fetchOptions: { signal: AbortSignal.timeout(5000) }
			});
			if (session.error || session.data?.session.id !== user.sessionId) {
				this.error = 'auth.passkey_nudge.failed';
				return false;
			}
			// One generic message for every failure, whatever the server's code says.
			const result = await addPasskey(this.name.trim() || this.suggestedName);
			if (!result.ok) {
				this.error = 'auth.passkey_nudge.failed';
				return false;
			}
			created = true;
			haptic.trigger('medium');
			toast.success(this.#t.current('auth.messages.passkey_added'));
			return true;
		} catch {
			this.error = 'auth.passkey_nudge.failed';
			return false;
		} finally {
			if (!created) this.busy = false;
		}
	}

	async skip() {
		const user = this.#user();
		if (this.busy || !user) return;
		this.busy = true;
		await deferPasskeyNudge(this.#client, user.userId);
		this.#oncontinue();
	}
}

/**
 * The OAuth passkey offer of the app shell, with its form state. Both live at the shell's
 * lifetime because the sidebar remounts its content when it switches between the desktop rail
 * and the mobile sheet: a claimed offer is already marked as seen, and a typed name or a
 * pending registration must survive the switch.
 * Create it during component initialisation: it reads context and owns effects.
 */
export class PasskeyNudgeClaim {
	#auth = useAuth();
	#offer = $state<{ user: PasskeyNudgeUser; provider: PendingOAuthProvider } | null>(null);
	readonly enrollment = new PasskeyEnrollment(
		() => this.offer?.user ?? null,
		() => this.dismiss()
	);

	constructor(enabled: () => boolean) {
		const client = useConvexClient();
		$effect(() => {
			const pending = pendingPasskeyNudge.current;
			if (!enabled() || this.#auth.isLoading || !this.#auth.isAuthenticated || !pending) return;
			let cancelled = false;
			void claimPasskeyNudge(client, pending.sessionId).then((user) => {
				if (cancelled) return;
				pendingPasskeyNudge.current = null;
				if (user && this.#auth.isAuthenticated) this.#offer = { user, provider: pending.provider };
			});
			return () => {
				cancelled = true;
			};
		});
	}

	get offer() {
		return this.#auth.isAuthenticated ? this.#offer : null;
	}

	async create() {
		if (await this.enrollment.create()) this.dismiss();
	}

	dismiss() {
		this.#offer = null;
	}
}
