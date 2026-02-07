<script lang="ts">
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useSearchParams } from 'runed/kit';
	import { authParamsSchema } from '$lib/schemas/auth.js';
	import { localizedHref } from '$lib/utils/i18n';
	import { safeRedirectPath } from '$lib/utils/url';
	import * as Card from '$lib/components/ui/card/index.js';
	import { LoadingBar } from '$lib/components/ui/loading-bar/index.js';
	import { FieldGroup } from '$lib/components/ui/field/index.js';
	import { T, getTranslate } from '@tolgee/svelte';

	const auth = useAuth();
	const { t } = getTranslate();
	const params = useSearchParams(authParamsSchema, {
		debounce: 300,
		pushHistory: false
	});

	let pageLoadTime = Date.now();
	let hasRedirected = $state(false);
	const verifiedDescription = $derived(
		$t('auth.verification.verified_description').replace(/\. /u, '.\n')
	);

	// Redirect to destination once authenticated (with 1.5s min display time)
	$effect(() => {
		if (auth.isLoading || !auth.isAuthenticated || hasRedirected) return;

		const elapsed = Date.now() - pageLoadTime;
		const remaining = Math.max(0, 1500 - elapsed);

		const timeoutId = setTimeout(() => {
			hasRedirected = true;
			const destination = safeRedirectPath(params.redirectTo, localizedHref('/app'));
			window.location.href = destination;
		}, remaining);

		return () => clearTimeout(timeoutId);
	});

	// Fallback: redirect to signin if auth has settled but user is not authenticated after 10s
	$effect(() => {
		if (hasRedirected) return;

		const timeoutId = setTimeout(() => {
			if (!auth.isLoading && !auth.isAuthenticated) {
				const destination = safeRedirectPath(params.redirectTo, localizedHref('/app'));
				const signinUrl = `${localizedHref('/signin')}?redirectTo=${encodeURIComponent(destination)}`;
				window.location.href = signinUrl;
			}
		}, 10000);

		return () => clearTimeout(timeoutId);
	});
</script>

<div class="flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
	<div class="flex w-full max-w-sm flex-col gap-6 md:max-w-3xl">
		<Card.Root class="overflow-hidden p-0">
			<Card.Content class="grid p-0 md:grid-cols-2">
				<div class="min-h-96">
					<LoadingBar indeterminate class="h-1 rounded-none" />
					<div class="flex h-full flex-col justify-center p-6 md:p-8">
						<FieldGroup>
							<div class="flex flex-col items-center gap-2 text-center">
								<h1 class="text-2xl font-bold">
									<T keyName="auth.verification.verified_title" />
								</h1>
								<p class="text-balance whitespace-pre-line text-muted-foreground">
									{verifiedDescription}
								</p>
							</div>
						</FieldGroup>
					</div>
				</div>
				<div class="relative hidden bg-muted md:block">
					<img
						src="/placeholder.svg"
						alt=""
						draggable="false"
						class="absolute inset-0 h-full w-full object-cover select-none dark:brightness-[0.2] dark:grayscale"
					/>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
</div>
