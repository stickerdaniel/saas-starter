<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';
	import { T } from '@tolgee/svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';

	type Props = {
		children: Snippet;
		/** Where a visitor who is already signed in can go on to; empty for everyone else. */
		resumeHref?: string;
	};

	let { children, resumeHref = '' }: Props = $props();

	/**
	 * Stands in for the auth form column while the page has not hydrated. The
	 * form's controls stay disabled until then, so a browser that never gets
	 * there needs a way out other than the form.
	 *
	 * The server renders the form and a collapsed fallback into the same cell.
	 * A normal load hydrates well within the grace period and removes the
	 * fallback before it takes any room. After the grace period, CSS alone hides
	 * the form and reveals the fallback, since the scripts that would do it are
	 * the ones that did not arrive; the form is hidden rather than removed, so a
	 * late hydration brings back the same fields with whatever they hold.
	 * Without scripting, the `<noscript>` style below shows the fallback at once,
	 * with copy that says JavaScript is off rather than that loading stalled.
	 * That style rather than `@media (scripting: none)`, which Safari before 17
	 * lacks.
	 *
	 * The status region stays in place while its content is collapsed, but a
	 * reveal done by CSS is not guaranteed to be announced.
	 */
	let pending = $state(true);
	let fallback = $state<HTMLElement | null>(null);
	let formPane = $state<HTMLElement | null>(null);

	// The page's own controls enable in their mount callbacks, which have run by
	// the time this one does; the tick lets those updates reach the DOM first.
	onMount(async () => {
		await tick();
		const focusWasInFallback = fallback?.contains(document.activeElement) ?? false;
		pending = false;
		if (!focusWasInFallback) return;
		await tick();
		formPane
			?.querySelector<HTMLElement>(
				'input:not([disabled]):not([type="hidden"]), button:not([disabled]), a[href]'
			)
			?.focus();
	});

	// The current address, token and redirect included, so reloading resumes
	// exactly this page. Only rendered while pending, before anything rewrites it.
	const reloadHref = $derived(page.url.pathname + page.url.search);
</script>

<svelte:head>
	<noscript>
		<!-- Outranks the scoped styles below, whose selectors carry a hash class. -->
		<style>
			[data-auth-gate-fallback] {
				height: auto !important;
				visibility: visible !important;
				animation: none !important;
			}
			[data-auth-gate-form] {
				visibility: hidden !important;
				animation: none !important;
			}
			[data-auth-gate-stalled] {
				display: none !important;
			}
			[data-auth-gate-noscript] {
				display: flex !important;
			}
		</style>
	</noscript>
</svelte:head>

<div class="grid min-w-0" data-auth-gate-pending={pending ? '' : undefined}>
	<div role="status" aria-atomic="true" class="col-start-1 row-start-1 grid min-w-0">
		{#if pending}
			<div bind:this={fallback} class="auth-gate-fallback min-w-0" data-auth-gate-fallback>
				<!-- Laid out like the forms it stands in for, down to the room their
				     edge loading bar takes above the heading. -->
				<div class="h-1"></div>
				<div class="min-h-96 p-6 md:p-8">
					<Field.Group>
						<div class="flex flex-col items-center gap-2 text-center" data-auth-gate-stalled>
							<h1 class="text-2xl font-bold"><T keyName="auth.gate.stalled_title" /></h1>
							<p class="text-balance text-muted-foreground">
								<T keyName="auth.gate.stalled_description" />
							</p>
						</div>
						<div class="hidden flex-col items-center gap-2 text-center" data-auth-gate-noscript>
							<h1 class="text-2xl font-bold"><T keyName="auth.gate.noscript_title" /></h1>
							<p class="text-balance text-muted-foreground">
								<T keyName="auth.gate.noscript_description" />
							</p>
						</div>
						<!-- Plain links with full-document navigation: the client router is
						     exactly what may not have loaded. -->
						{#if resumeHref}
							<Field.Field>
								<Button href={resolve(resumeHref)} data-sveltekit-reload class="w-full">
									<T keyName="auth.signin.button_resume" />
								</Button>
							</Field.Field>
						{/if}
						<Field.Field>
							<Button
								href={reloadHref}
								data-sveltekit-reload
								variant={resumeHref ? 'outline' : 'default'}
								class="w-full"
							>
								<T keyName="auth.gate.reload" />
							</Button>
						</Field.Field>
					</Field.Group>
				</div>
			</div>
		{/if}
	</div>
	<div
		bind:this={formPane}
		class="auth-gate-form col-start-1 row-start-1 grid min-w-0"
		data-auth-gate-form
	>
		{@render children()}
	</div>
</div>

<style>
	/* Collapsed rather than only invisible, so a load that hydrates in time never
	   makes room for it. The panel inside carries the padding and minimum height,
	   so the collapsed box really is empty. */
	.auth-gate-fallback {
		height: 0;
		min-height: 0;
		overflow: hidden;
		visibility: hidden;
		animation: auth-gate-stall 0s 4s forwards;
	}

	/* The form stays in the flow, so the card keeps at least its height. */
	[data-auth-gate-pending] > .auth-gate-form {
		animation: auth-gate-hide 0s 4s forwards;
	}

	@keyframes auth-gate-stall {
		to {
			height: auto;
			visibility: visible;
		}
	}

	@keyframes auth-gate-hide {
		to {
			visibility: hidden;
		}
	}
</style>
