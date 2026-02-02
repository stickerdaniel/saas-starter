<script lang="ts">
	import * as v from 'valibot';
	import * as InputGroup from '$lib/components/ui/input-group';
	import { Button } from '$lib/components/ui/button';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';
	import { emailSchema } from '$lib/schemas/auth';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	let {
		currentEmail = '',
		isEmailPending = false,
		defaultEmail = '',
		onSubmitEmail
	}: {
		/** Currently saved notification email from thread */
		currentEmail?: string;
		/** True while email mutation is in flight (green check hidden until confirmed) */
		isEmailPending?: boolean;
		/** Fallback email (e.g., from logged-in user) */
		defaultEmail?: string;
		onSubmitEmail: (email: string) => Promise<void>;
	} = $props();

	// Initialize with saved email, fallback to default, or empty
	// Intentionally seed local state; external currentEmail changes are synced below.
	// svelte-ignore state_referenced_locally
	let email = $state(currentEmail || defaultEmail || '');
	let isSubmitting = $state(false);

	// Local optimistic state - allows immediate UI feedback before Convex query propagates
	// null = use currentEmail, true = optimistically subscribed, false = optimistically unsubscribed
	let optimisticSubscribed = $state<boolean | null>(null);

	// Track the previous currentEmail to detect external changes (e.g., switching threads)
	// Intentionally snapshot previous value for change detection.
	// svelte-ignore state_referenced_locally
	let prevCurrentEmail = currentEmail;

	// Sync email only when currentEmail prop actually changes externally
	$effect(() => {
		if (currentEmail !== prevCurrentEmail) {
			// External change (e.g., switching threads or Convex query update) - sync to new value
			// Use empty string if currentEmail is empty (don't fall back to defaultEmail after unsubscribe)
			email = currentEmail || '';
			prevCurrentEmail = currentEmail;
			// Clear optimistic state - real value has arrived
			optimisticSubscribed = null;
		}
	});

	const isValidEmail = $derived(v.safeParse(emailSchema, email.trim()).success);

	// Check if email has changed from the saved value
	const hasChanges = $derived(email.trim() !== (currentEmail || ''));

	// Is user currently subscribed - use local optimistic state if set, otherwise use server state
	const isSubscribed = $derived(optimisticSubscribed ?? !!currentEmail);

	// Show green check only when subscribed AND server has confirmed (not pending, no local optimistic override)
	const showConfirmed = $derived(
		!!currentEmail && !isEmailPending && optimisticSubscribed === null
	);

	// Can subscribe: valid email AND email has changed from saved value
	const canSubscribe = $derived(isValidEmail && hasChanges);

	async function handleSubmit() {
		if (!canSubscribe || isSubmitting) return;

		// Optimistic: immediately show subscribed state
		optimisticSubscribed = true;
		isSubmitting = true;

		try {
			await onSubmitEmail(email.trim());
		} catch {
			// Rollback optimistic state on error
			optimisticSubscribed = null;
		} finally {
			isSubmitting = false;
		}
	}

	async function handleUnsubscribe() {
		if (isSubmitting) return;

		// Optimistic: immediately show unsubscribed state (enables input)
		optimisticSubscribed = false;
		email = '';
		isSubmitting = true;

		try {
			await onSubmitEmail('');
		} catch {
			// Rollback optimistic state on error
			optimisticSubscribed = null;
			email = currentEmail || '';
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
			disabled={isSubscribed}
			onkeydown={(e) => e.key === 'Enter' && canSubscribe && handleSubmit()}
		/>
		{#if showConfirmed}
			<InputGroup.Addon align="inline-end">
				<CircleCheckIcon class="h-4 w-4 text-green-600" />
			</InputGroup.Addon>
		{/if}
	</InputGroup.Root>

	{#if isSubscribed}
		<Button variant="outline" size="icon" onclick={handleUnsubscribe} disabled={isSubmitting}>
			<BellOffIcon class="h-4 w-4" />
		</Button>
	{:else}
		<Button variant="outline" onclick={handleSubmit} disabled={!canSubscribe || isSubmitting}>
			{$t('chat.email.subscribe_button')}
		</Button>
	{/if}
</div>
