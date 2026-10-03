<script lang="ts">
	import { tick } from 'svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { LoadingBar } from '$lib/components/ui/loading-bar';
	import { translateFormError } from '$lib/utils/validation-i18n.js';
	import type { PasskeyNudgeUser } from '$lib/utils/passkey-nudge';
	import { PasskeyEnrollment } from './passkey-enrollment.svelte.ts';

	let { user, oncontinue }: { user: PasskeyNudgeUser; oncontinue: () => void } = $props();

	const { t } = getTranslate();
	const offer = new PasskeyEnrollment(
		() => user,
		() => oncontinue()
	);
	const id = $props.id();
	let complete = $state(false);
	let heading: HTMLHeadingElement;

	function focusHeading(element: HTMLHeadingElement) {
		heading = element;
		element.focus({ preventScroll: true });
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!(await offer.create())) return;
		complete = true;
		await tick();
		heading.focus({ preventScroll: true });
	}
</script>

<form onsubmit={handleSubmit} novalidate class="min-h-96">
	<LoadingBar
		value={complete ? 100 : 0}
		mode={offer.busy ? 'loading' : 'progress'}
		showBackground={false}
		variant="edge"
	/>
	<div class="p-6 md:p-8">
		<Field.Group>
			<div class="flex flex-col items-center gap-2 text-center">
				<h1 tabindex="-1" class="text-2xl font-bold outline-none" {@attach focusHeading}>
					<T keyName={complete ? 'auth.passkey_nudge.success_title' : 'auth.passkey_nudge.title'} />
				</h1>
				<p class="text-balance text-muted-foreground">
					<T
						keyName={complete
							? 'auth.passkey_nudge.success_description'
							: 'auth.passkey_nudge.description'}
					/>
				</p>
			</div>
			{#if complete}
				<Field.Field>
					<Button type="button" class="w-full" onclick={oncontinue}>
						<T keyName="auth.passkey_nudge.continue" />
					</Button>
				</Field.Field>
			{:else}
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
			{/if}
		</Field.Group>
	</div>
</form>
