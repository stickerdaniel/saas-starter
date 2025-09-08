<script>
	import { useAuth } from '$lib/sveltekit';
	import { goto } from '$app/navigation';
	import { env } from '$env/dynamic/public';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	const { signIn } = useAuth();
</script>

<div class="flex min-h-screen w-full">
	<main class="mx-auto my-auto flex flex-col">
		<h2 class="mb-4 text-2xl font-semibold tracking-tight">Sign in or create an account</h2>
		<Button onclick={() => signIn('github', { redirectTo: '/product' })} class="w-full">
			Sign In with GitHub
		</Button>
		<Button onclick={() => signIn('google', { redirectTo: '/product' })} class="w-full">
			Sign In with Google
		</Button>
		{#if env.PUBLIC_E2E_TEST}
			<form
				class="mt-8 flex flex-col gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					const formData = new FormData(event.currentTarget);
					signIn('secret', formData)
						.then(() => {
							goto('/product');
						})
						.catch(() => {
							window.alert('Invalid secret');
						});
				}}
			>
				Test only: Sign in with a secret
				<Input aria-label="Secret" type="text" name="secret" placeholder="secret value" />
				<Button type="submit">Sign in with secret</Button>
			</form>
		{/if}

		<a class="anchor" href="/">Cancel</a>
	</main>
</div>
