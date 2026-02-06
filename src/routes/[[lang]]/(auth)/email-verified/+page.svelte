<script lang="ts">
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useSearchParams } from 'runed/kit';
	import { authParamsSchema } from '$lib/schemas/auth.js';
	import { localizedHref } from '$lib/utils/i18n';
	import { safeRedirectPath } from '$lib/utils/url';
	import * as Card from '$lib/components/ui/card/index.js';
	import { FieldGroup, Field } from '$lib/components/ui/field/index.js';
	import { T } from '@tolgee/svelte';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	const auth = useAuth();
	const params = useSearchParams(authParamsSchema, {
		debounce: 300,
		pushHistory: false
	});

	let pageLoadTime = Date.now();
	let hasRedirected = $state(false);

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
				<div class="flex min-h-96 flex-col justify-center p-6 md:p-8">
					<FieldGroup>
						<div class="flex flex-col items-center gap-2 text-center">
							<h1 class="text-2xl font-bold">
								<T keyName="auth.verification.verified_title" />
							</h1>
							<p class="text-balance text-muted-foreground">
								<T keyName="auth.verification.verified_description" />
							</p>
						</div>
						<Field class="flex justify-center">
							<LoaderCircleIcon class="h-5 w-5 animate-spin text-muted-foreground" />
						</Field>
					</FieldGroup>
				</div>
				<div class="relative hidden bg-muted md:block">
					<img
						src="/placeholder.svg"
						alt=""
						class="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
					/>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
</div>
