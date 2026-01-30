<script lang="ts">
	import * as v from 'valibot';
	import { toast } from 'svelte-sonner';
	import * as InputGroup from '$lib/components/ui/input-group';
	import { Button } from '$lib/components/ui/button';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';
	import { emailSchema } from '$lib/schemas/auth';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

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

	// Track the previous currentEmail to detect external changes (e.g., switching threads)
	let prevCurrentEmail = $state(currentEmail);

	// Sync email only when currentEmail prop actually changes externally
	$effect(() => {
		if (currentEmail !== prevCurrentEmail) {
			// External change (e.g., switching threads) - sync to new value
			// Use empty string if currentEmail is empty (don't fall back to defaultEmail after unsubscribe)
			email = currentEmail || '';
			prevCurrentEmail = currentEmail;
		}
	});

	const isValidEmail = $derived(v.safeParse(emailSchema, email.trim()).success);

	// Check if email has changed from the saved value
	const hasChanges = $derived(email.trim() !== (currentEmail || ''));

	// Is user currently subscribed (saved email exists and matches current input)
	const _isSubscribed = $derived(!!currentEmail && currentEmail === email.trim());

	// Can subscribe: valid email AND email has changed from saved value
	const canSubscribe = $derived(isValidEmail && hasChanges);

	async function handleSubmit() {
		if (!canSubscribe || isSubmitting) return;

		isSubmitting = true;
		try {
			await onSubmitEmail(email.trim());
			toast.success($t('chat.email.saved_success'));
		} catch {
			toast.error($t('chat.email.save_failed'));
		} finally {
			isSubmitting = false;
		}
	}

	async function handleUnsubscribe() {
		if (isSubmitting) return;

		isSubmitting = true;
		try {
			email = '';
			await onSubmitEmail('');
			toast.success($t('chat.email.unsubscribed'));
		} catch {
			toast.error($t('chat.email.unsubscribe_failed'));
		} finally {
			isSubmitting = false;
		}
	}
</script>

<div class="mt-3 flex w-full max-w-sm items-center gap-2">
	<InputGroup.Root>
		<InputGroup.Input
			type="email"
			placeholder={$t('chat.email.placeholder')}
			bind:value={email}
			disabled={!!currentEmail}
			onkeydown={(e) => e.key === 'Enter' && canSubscribe && handleSubmit()}
		/>
		{#if currentEmail}
			<InputGroup.Addon align="inline-end">
				<CircleCheckIcon class="h-4 w-4 text-green-600" />
			</InputGroup.Addon>
		{/if}
	</InputGroup.Root>

	{#if currentEmail}
		<Button variant="outline" size="icon" onclick={handleUnsubscribe} disabled={isSubmitting}>
			<BellOffIcon class="h-4 w-4" />
		</Button>
	{:else}
		<Button variant="outline" onclick={handleSubmit} disabled={!canSubscribe || isSubmitting}>
			{$t('chat.email.subscribe_button')}
		</Button>
	{/if}
</div>
