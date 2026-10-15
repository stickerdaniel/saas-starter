<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import FingerprintIcon from '@lucide/svelte/icons/fingerprint-pattern';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { translateFormError } from '#lib/utils/validation-i18n.js';
	import type { PasskeyNudgeClaim } from './passkey-enrollment.svelte.ts';

	let { nudge }: { nudge: PasskeyNudgeClaim } = $props();

	const { t } = getTranslate();
	const offer = $derived(nudge.enrollment);
	const id = $props.id();

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		void nudge.create();
	}
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title id="passkey-offer-{id}-title"
			><T keyName="auth.passkey_nudge.inline_title" /></Card.Title
		>
		<Card.Action>
			<!-- Closing defers the offer like "Not now" on the setup page, for this account. -->
			<Button
				type="button"
				variant="ghost-muted"
				size="icon-xs"
				aria-label={$t('auth.passkey_nudge.not_now')}
				disabled={offer.busy}
				onclick={() => offer.skip()}
			>
				<XIcon class="size-4" />
			</Button>
		</Card.Action>
		<Card.Description>
			<T keyName="auth.passkey_nudge.description" />
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
				<FingerprintIcon data-icon="inline-start" />
				<T keyName={offer.busy ? 'auth.passkey_nudge.working' : 'auth.passkey_nudge.create'} />
			</Button>
		</form>
	</Card.Content>
</Card.Root>
