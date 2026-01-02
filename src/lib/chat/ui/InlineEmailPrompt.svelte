<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';

	let {
		currentEmail = '',
		defaultEmail = '',
		onSubmitEmail
	}: {
		/** Currently saved notification email from thread */
		currentEmail?: string;
		/** Fallback email (e.g., from logged-in user) */
		defaultEmail?: string;
		onSubmitEmail: (email: string) => Promise<void>;
	} = $props();

	// Initialize with saved email, fallback to default, or empty
	let email = $state(currentEmail || defaultEmail || '');
	let isSubmitting = $state(false);

	// Sync email when currentEmail prop changes (e.g., switching threads or after save)
	$effect(() => {
		if (currentEmail) {
			email = currentEmail;
		} else if (defaultEmail && !email) {
			email = defaultEmail;
		}
	});

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const isValidEmail = $derived(emailRegex.test(email.trim()));

	// Check if email has changed from the saved value
	const hasChanges = $derived(email.trim() !== (currentEmail || ''));

	async function handleSubmit() {
		if (!isValidEmail || isSubmitting) return;

		isSubmitting = true;
		try {
			await onSubmitEmail(email.trim());
			toast.success("Email saved! We'll notify you when we respond.");
		} catch (error) {
			toast.error('Failed to save email. Please try again.');
		} finally {
			isSubmitting = false;
		}
	}
</script>

<div class="mt-3 flex w-full max-w-sm items-center gap-2">
	<Input
		type="email"
		placeholder="Email"
		bind:value={email}
		onkeydown={(e) => e.key === 'Enter' && handleSubmit()}
	/>
	<Button
		type="submit"
		variant="outline"
		disabled={!isValidEmail || isSubmitting || !hasChanges}
		onclick={handleSubmit}
	>
		Subscribe
	</Button>
</div>
