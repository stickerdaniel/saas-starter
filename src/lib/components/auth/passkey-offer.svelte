<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { LoadingBar } from '$lib/components/ui/loading-bar';
	import { translateFormError } from '$lib/utils/validation-i18n.js';
	import type { PasskeyNudgeUser } from '$lib/utils/passkey-nudge';
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
		<Field.Group>
			<div class="flex flex-col items-center gap-2 text-center">
				<h1
					tabindex="-1"
					class="text-2xl font-bold text-balance outline-none"
					{@attach focusHeading}
				>
					<T keyName="auth.passkey_nudge.title" />
				</h1>
				<p class="text-balance text-muted-foreground">
					<T keyName="auth.passkey_nudge.description" />
				</p>
			</div>
			<Field.Field>
				<Field.Label for="passkey-name-{id}">
					<T keyName="settings.security.passkey_name_label" />
				</Field.Label>
				<Input
					id="passkey-name-{id}"
					type="text"
					autocomplete="off"
					disabled={offer.busy}
					aria-describedby="passkey-name-{id}-description"
					bind:value={offer.name}
				/>
				<Field.Description id="passkey-name-{id}-description">
					<T keyName="auth.passkey_nudge.password_backup" />
				</Field.Description>
			</Field.Field>
			<Field.Error errors={translateFormError(offer.error, $t)} />
			<Field.Field>
				<Button type="submit" class="w-full" disabled={offer.busy}>
					<T keyName={offer.busy ? 'auth.passkey_nudge.working' : 'auth.passkey_nudge.create'} />
				</Button>
				<Button
					type="button"
					variant="ghost"
					class="w-full"
					disabled={offer.busy}
					onclick={() => offer.skip()}
				>
					<T keyName="auth.passkey_nudge.not_now" />
				</Button>
			</Field.Field>
		</Field.Group>
	</div>
</form>
