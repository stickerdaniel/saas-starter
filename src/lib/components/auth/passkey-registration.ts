import type { DefaultParamType, TFnType, TranslationKey } from '@tolgee/svelte';
import { authClient } from '#lib/auth-client.js';
import type { getPasskeyDevice } from '#lib/utils/passkey-device.js';

type Translate = TFnType<DefaultParamType, string, TranslationKey>;

/** The name a new passkey starts with: the user's first name and the device it lives on. */
export function suggestPasskeyName(
	t: Translate,
	userName: string | null | undefined,
	device: ReturnType<typeof getPasskeyDevice>
): string {
	const firstName = userName?.trim().split(/\s+/)[0] ?? '';
	return t(
		`settings.security.passkey.${firstName ? 'suggested_name' : 'suggested_name_anonymous'}`,
		{
			name: firstName,
			device: t(`settings.security.passkey.devices.${device}`)
		}
	);
}

export type PasskeyRegistration = { ok: true } | { ok: false; error: unknown };

/**
 * Registers a passkey for the signed-in user. Succeeds only once the server has stored it:
 * a response without data is a failure even when it carries no error. Never throws, and
 * leaves the wording of a failure to the caller.
 */
export async function addPasskey(name: string): Promise<PasskeyRegistration> {
	try {
		const result = await authClient.passkey.addPasskey({ name });
		if (result.error || !result.data) return { ok: false, error: result.error };
		return { ok: true };
	} catch (error) {
		return { ok: false, error };
	}
}
