import { fromStore } from 'svelte/store';
import { getTranslate } from '@tolgee/svelte';
import { useConvexClient } from 'convex-svelte';
import { authClient } from '$lib/auth-client';
import { getPasskeyDevice } from '$lib/utils/passkey-device';
import { deferPasskeyNudge, type PasskeyNudgeUser } from '$lib/utils/passkey-nudge';

/**
 * The state behind a passkey offer, shared by the setup page and the sidebar card.
 * Create it during component initialisation: it reads context and owns an effect.
 */
export class PasskeyEnrollment {
	#user: () => PasskeyNudgeUser;
	#oncontinue: () => void;
	#client = useConvexClient();
	#t = fromStore(getTranslate().t);
	#editedName = $state<string>();

	busy = $state(false);
	/** Translation key of the last failure, empty when there is none. */
	error = $state('');

	readonly suggestedName = $derived.by(() => {
		const t = this.#t.current;
		const firstName = this.#user().name.trim().split(/\s+/)[0] ?? '';
		return t(
			`settings.security.passkey.${firstName ? 'suggested_name' : 'suggested_name_anonymous'}`,
			{
				name: firstName,
				device: t(`settings.security.passkey.devices.${getPasskeyDevice(navigator)}`)
			}
		);
	});

	constructor(user: () => PasskeyNudgeUser, oncontinue: () => void) {
		this.#user = user;
		this.#oncontinue = oncontinue;
		const session = fromStore(authClient.useSession());
		// Another account signed in elsewhere in this browser: the offer is not theirs.
		$effect(() => {
			const data = session.current.data;
			if (data && data.session.id !== this.#user().sessionId) this.#oncontinue();
		});
	}

	get name() {
		return this.#editedName ?? this.suggestedName;
	}

	set name(value: string) {
		this.#editedName = value;
	}

	/** Resolves true only once the server has stored the new passkey. */
	async create(): Promise<boolean> {
		if (this.busy) return false;
		this.busy = true;
		this.error = '';
		try {
			const session = await authClient.getSession({
				fetchOptions: { signal: AbortSignal.timeout(5000) }
			});
			if (session.error || session.data?.session.id !== this.#user().sessionId) {
				this.error = 'auth.passkey_nudge.failed';
				return false;
			}
			const result = await authClient.passkey.addPasskey({
				name: this.name.trim() || this.suggestedName
			});
			if (result.error || !result.data) {
				this.error = 'auth.passkey_nudge.failed';
				return false;
			}
			return true;
		} catch {
			this.error = 'auth.passkey_nudge.failed';
			return false;
		} finally {
			this.busy = false;
		}
	}

	async skip() {
		if (this.busy) return;
		this.busy = true;
		await deferPasskeyNudge(this.#client, this.#user().userId);
		this.#oncontinue();
	}
}
