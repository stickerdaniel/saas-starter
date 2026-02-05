<script lang="ts">
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useSearchParams } from 'runed/kit';
	import { authParamsSchema } from '$lib/schemas/auth.js';
	import { localizedHref } from '$lib/utils/i18n';
	import * as Card from '$lib/components/ui/card/index.js';
	import { FieldGroup, Field } from '$lib/components/ui/field/index.js';
	import { T } from '@tolgee/svelte';
	import CircleCheckBigIcon from '@lucide/svelte/icons/circle-check-big';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	const auth = useAuth();
	const params = useSearchParams(authParamsSchema, {
		debounce: 300,
		pushHistory: false
	});

	let pageLoadTime = Date.now();
	let hasRedirected = $state(false);

	$effect(() => {
		// Wait for auth to finish loading (pattern from +layout.svelte:107)
		if (auth.isLoading) return;

		// If not authenticated after loading, redirect to signin
		if (!auth.isAuthenticated) {
			window.location.href = localizedHref('/signin');
			return;
		}

		// If authenticated, redirect after minimum display time (1.5s to avoid flicker)
		if (!hasRedirected) {
			const elapsed = Date.now() - pageLoadTime;
			const remaining = Math.max(0, 1500 - elapsed);

			const timeoutId = setTimeout(() => {
				hasRedirected = true;
				const destination = params.redirectTo || localizedHref('/app');
				window.location.href = destination;
			}, remaining);

			// Cleanup: clear timeout if effect re-runs or component unmounts (Svelte 5 pattern)
			return () => clearTimeout(timeoutId);
		}
	});
</script>

<div class="flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
	<div class="flex w-full max-w-sm flex-col gap-6 md:max-w-3xl">
		<Card.Root class="overflow-hidden p-0">
			<Card.Content class="grid p-0 md:grid-cols-2">
				<div class="p-6 md:p-8">
					<FieldGroup>
						<div class="flex flex-col items-center gap-4 text-center">
							<CircleCheckBigIcon class="h-12 w-12 text-green-500" />
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
