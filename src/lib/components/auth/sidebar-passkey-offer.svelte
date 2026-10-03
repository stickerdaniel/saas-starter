<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import { translateFormError } from '$lib/utils/validation-i18n.js';
	import type { PasskeyNudgeUser } from '$lib/utils/passkey-nudge';
	import type { PendingOAuthProvider } from '$lib/hooks/last-auth-method.svelte.ts';
	import { PasskeyEnrollment } from './passkey-enrollment.svelte.ts';

	let {
		user,
		provider,
		oncontinue
	}: { user: PasskeyNudgeUser; provider: PendingOAuthProvider; oncontinue: () => void } = $props();

	const { t } = getTranslate();
	const offer = new PasskeyEnrollment(
		() => user,
		() => oncontinue()
	);
	const id = $props.id();

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!(await offer.create())) return;
		haptic.trigger('medium');
		toast.success($t('auth.messages.passkey_added'));
		oncontinue();
	}
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title id="passkey-offer-{id}-title"
			><T keyName="auth.passkey_nudge.inline_title" /></Card.Title
		>
		<Card.Description>
			<T keyName="auth.passkey_nudge.description" />
			<T
				keyName="auth.passkey_nudge.provider_backup"
				params={{ provider: provider === 'google' ? 'Google' : 'GitHub' }}
			/>
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<form
			onsubmit={handleSubmit}
			novalidate
			aria-labelledby="passkey-offer-{id}-title"
			class="flex flex-col gap-2"
		>
			<Field.Label for="passkey-name-{id}" class="sr-only">
				<T keyName="settings.security.passkey_name_label" />
			</Field.Label>
			<Sidebar.Input
				id="passkey-name-{id}"
				type="text"
				autocomplete="off"
				disabled={offer.busy}
				bind:value={offer.name}
			/>
			<Field.Error errors={translateFormError(offer.error, $t)} />
			<Button type="submit" size="sm" class="w-full" disabled={offer.busy}>
				<T keyName={offer.busy ? 'auth.passkey_nudge.working' : 'auth.passkey_nudge.create'} />
			</Button>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				class="w-full"
				disabled={offer.busy}
				onclick={() => offer.skip()}
			>
				<T keyName="auth.passkey_nudge.not_now" />
			</Button>
		</form>
	</Card.Content>
</Card.Root>
