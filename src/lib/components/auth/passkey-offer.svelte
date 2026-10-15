<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import FingerprintIcon from '@lucide/svelte/icons/fingerprint-pattern';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import Logo from '#lib/components/icons/logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { LoadingBar } from '#lib/components/ui/loading-bar/index.js';
	import { translateFormError } from '#lib/utils/validation-i18n.js';
	import type { PasskeyNudgeUser } from '#lib/utils/passkey-nudge.js';
	import { PasskeyEnrollment } from './passkey-enrollment.svelte.ts';

	let {
		user,
		oncontinue,
		oncreated
	}: { user: PasskeyNudgeUser; oncontinue: () => void; oncreated: () => void } = $props();

	const { t } = getTranslate();
	const offer = new PasskeyEnrollment(
		() => user,
		() => oncontinue()
	);
	const id = $props.id();

	const facts = [
		{ icon: FingerprintIcon, key: 'auth.passkey_nudge.facts.unlock' },
		{ icon: SmartphoneIcon, key: 'auth.passkey_nudge.facts.on_device' },
		{ icon: KeyRoundIcon, key: 'auth.passkey_nudge.facts.password' }
	];

	function focusHeading(element: HTMLHeadingElement) {
		element.focus({ preventScroll: true });
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (await offer.create()) oncreated();
	}
</script>

<form onsubmit={handleSubmit} novalidate class="flex min-h-96 flex-col">
	<LoadingBar
		value={0}
		mode={offer.busy ? 'loading' : 'progress'}
		showBackground={false}
		variant="edge"
	/>
	<div class="flex flex-1 flex-col justify-center p-6 md:p-8">
		<!-- The brand mark only: a link out would drop the visitor's destination. -->
		<Logo class="mb-6 size-6 text-foreground" />
		<Field.Group>
			<div class="flex flex-col gap-2">
				<h1 tabindex="-1" class="text-2xl font-bold outline-none" {@attach focusHeading}>
					<T keyName="auth.passkey_nudge.title" />
				</h1>
				<p class="text-balance text-muted-foreground">
					<T keyName="auth.passkey_nudge.lead" />
				</p>
			</div>
			<ul class="flex flex-col gap-3 text-sm">
				{#each facts as fact (fact.key)}
					<li class="flex items-center gap-3">
						<span
							class="grid size-8 shrink-0 place-items-center rounded-full bg-muted"
							aria-hidden="true"
						>
							<fact.icon class="size-4" />
						</span>
						<T keyName={fact.key} />
					</li>
				{/each}
			</ul>
			<Field.Field>
				<Field.Label for="passkey-name-{id}">
					<T keyName="settings.security.passkey_name_label" />
				</Field.Label>
				<Input
					id="passkey-name-{id}"
					type="text"
					autocomplete="off"
					disabled={offer.busy}
					bind:value={offer.name}
				/>
			</Field.Field>
			<Field.Error errors={translateFormError(offer.error, $t)} />
			<!-- Side by side while both labels fit; a longer translation stacks them, primary on top. -->
			<div class="flex flex-wrap-reverse gap-2">
				<Button
					type="button"
					variant="outline"
					class="flex-1"
					disabled={offer.busy}
					onclick={() => offer.skip()}
				>
					<T keyName="auth.passkey_nudge.not_now" />
				</Button>
				<Button type="submit" class="flex-1" disabled={offer.busy}>
					<T
						keyName={offer.busy ? 'auth.passkey_nudge.working' : 'auth.passkey_nudge.create_short'}
					/>
				</Button>
			</div>
		</Field.Group>
	</div>
</form>
