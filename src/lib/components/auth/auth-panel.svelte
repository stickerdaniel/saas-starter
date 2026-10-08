<script lang="ts">
	import type { Snippet } from 'svelte';
	import { T } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { localizedHref } from '#lib/utils/i18n.js';

	/**
	 * The two-column card every auth page sits in: the page's content beside the
	 * illustration, with at most one line of helper text below the card. That line
	 * is either the terms footer or the page's own `footer`, never both.
	 */
	type Props = {
		children: Snippet;
		/** Names the card for the view transition between sign-in and sign-up. */
		transition?: boolean;
	} & (
		| {
				/** Shows the terms, privacy and back-to-home links below the card. */
				legal: true;
				/** The rendered terms link, for a form that hands focus to it. */
				termsLink?: HTMLAnchorElement | null;
				footer?: never;
		  }
		| {
				legal?: false;
				termsLink?: never;
				/** Page-specific helper text in the terms footer's place. */
				footer?: Snippet;
		  }
	);

	let {
		children,
		transition = false,
		legal = false,
		termsLink = $bindable(null),
		footer
	}: Props = $props();
</script>

<div class="flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
	<div class="flex w-full max-w-sm flex-col gap-6 md:max-w-3xl">
		<Card.Root
			class={transition ? 'overflow-hidden p-0 auth-card-transition' : 'overflow-hidden p-0'}
		>
			<Card.Content class="grid p-0 md:grid-cols-2">
				{@render children()}
				<div class="relative hidden bg-muted md:block">
					<img
						src="/placeholder.svg"
						alt=""
						draggable="false"
						class="absolute inset-0 h-full w-full object-cover select-none dark:brightness-20 dark:grayscale"
					/>
				</div>
			</Card.Content>
		</Card.Root>
		{#if legal}
			<Field.Description class="px-6 text-center text-balance">
				<T keyName="auth.terms.agreement" defaultValue="By clicking continue, you agree to our" />
				<a
					bind:this={termsLink}
					href={resolve(localizedHref('/terms'))}
					class="underline underline-offset-4"
					><T keyName="auth.terms.terms_of_service" defaultValue="Terms of Service" /></a
				>
				<T keyName="auth.terms.and" defaultValue="and" />
				<a href={resolve(localizedHref('/privacy'))} class="underline underline-offset-4"
					><T keyName="auth.terms.privacy_policy" defaultValue="Privacy Policy" /></a
				>.
				<a href={resolve(localizedHref('/'))} class="underline underline-offset-4"
					><T keyName="auth.back_to_home" defaultValue="Back to home" /></a
				>
			</Field.Description>
		{:else if footer}
			<Field.Description class="px-6 text-center text-balance">
				{@render footer()}
			</Field.Description>
		{/if}
	</div>
</div>
