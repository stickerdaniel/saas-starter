<script lang="ts">
	import { cn } from '$lib/utils';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { Mail, Bug, Lightbulb, HelpCircle, LoaderCircle } from '@lucide/svelte';
	import type { ToolPart, TicketSubmitData, TicketType } from './types.js';
	import type { HTMLAttributes } from 'svelte/elements';
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';

	let {
		toolPart,
		threadId,
		onticketsubmit,
		onticketcancel,
		class: className,
		...restProps
	}: {
		toolPart: ToolPart;
		threadId?: string;
		onticketsubmit?: (data: TicketSubmitData) => void;
		onticketcancel?: () => void;
		class?: string;
	} & HTMLAttributes<HTMLDivElement> = $props();

	// Query for pre-filled email
	const emailQuery = $derived(
		threadId ? useQuery(api.support.ticketHelpers.getEmailForThread, { threadId }) : undefined
	);
	const prefillEmail = $derived(emailQuery?.data ?? '');

	// Form state - initialize from toolPart
	let title = $state(toolPart.title ?? '');
	let description = $state(toolPart.description ?? '');
	let email = $state('');
	let isSubmitting = $state(false);
	let error = $state('');

	// Initialize email from query when it loads
	$effect(() => {
		if (prefillEmail && !email) {
			email = prefillEmail;
		}
	});

	// Sanitize email to only allow valid email characters
	$effect(() => {
		const sanitized = email.replace(/[^a-zA-Z0-9@._\-+]/g, '');
		if (sanitized !== email) {
			email = sanitized;
		}
	});

	const ticketType = $derived(toolPart.ticketType ?? 'general_inquiry');

	const ticketTypeLabels: Record<TicketType, { label: string; icon: typeof Bug }> = {
		bug_report: { label: 'Bug Report', icon: Bug },
		feature_request: { label: 'Feature Request', icon: Lightbulb },
		general_inquiry: { label: 'General Inquiry', icon: HelpCircle }
	};

	const typeInfo = $derived(ticketTypeLabels[ticketType]);

	function isValidEmail(emailValue: string): boolean {
		const atIndex = emailValue.indexOf('@');
		if (atIndex === -1 || atIndex === 0) return false;
		const afterAt = emailValue.slice(atIndex + 1);
		return afterAt.includes('.') && !afterAt.startsWith('.') && !afterAt.endsWith('.');
	}

	const canSubmit = $derived(
		email.length > 0 &&
			isValidEmail(email) &&
			title.length > 0 &&
			description.length > 0 &&
			!isSubmitting
	);

	function handleSubmit() {
		if (!canSubmit) {
			if (!isValidEmail(email)) {
				error = 'Please enter a valid email address';
			} else if (title.length === 0) {
				error = 'Please enter a title';
			} else if (description.length === 0) {
				error = 'Please enter a description';
			}
			return;
		}
		error = '';
		isSubmitting = true;
		onticketsubmit?.({
			title,
			description,
			email,
			ticketType
		});
	}

	function handleCancel() {
		onticketcancel?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && e.ctrlKey && canSubmit) {
			e.preventDefault();
			handleSubmit();
		}
	}

	const { state: toolState, errorText } = $derived(toolPart);
</script>

<div class={cn('bg-background p-4', className)} {...restProps}>
	{#if toolState === 'output-processing'}
		<!-- Processing state - waiting for email delivery confirmation -->
		<p class="text-sm text-muted-foreground">Sending confirmation email...</p>
	{:else if toolState === 'output-available'}
		<!-- Success state -->
		<p class="text-sm text-muted-foreground">
			Your ticket has been submitted. We'll get back to you soon.
		</p>
	{:else if toolState === 'output-error'}
		<!-- Cancelled/Error state -->
		<div class="text-sm text-muted-foreground">
			{#if errorText}
				{errorText}
			{:else}
				Ticket submission was cancelled.
			{/if}
		</div>
	{:else}
		{@const TypeIcon = typeInfo.icon}
		<!-- Form state (input-streaming or input-available) -->
		<div class="space-y-4">
			<!-- Type Badge -->
			<div class="flex items-center gap-2">
				<TypeIcon class="h-4 w-4 text-primary" />
				<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
					{typeInfo.label}
				</span>
			</div>

			<!-- Title -->
			<div class="space-y-2">
				<Label for="ticket-title">Title</Label>
				<Input
					id="ticket-title"
					bind:value={title}
					placeholder="Brief summary of the issue"
					disabled={isSubmitting}
				/>
			</div>

			<!-- Description -->
			<div class="space-y-2">
				<Label for="ticket-description">Description</Label>
				<Textarea
					id="ticket-description"
					bind:value={description}
					placeholder="Detailed description..."
					rows={4}
					disabled={isSubmitting}
					class="resize-none"
				/>
			</div>

			<!-- Email -->
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<Mail class="h-4 w-4 text-muted-foreground" />
					<Label for="ticket-email">Your email for updates</Label>
				</div>
				<Input
					id="ticket-email"
					type="email"
					bind:value={email}
					placeholder="your@email.com"
					disabled={isSubmitting}
					onkeydown={handleKeydown}
					aria-invalid={error ? 'true' : undefined}
				/>
			</div>

			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}

			<!-- Buttons -->
			<div class="flex gap-2 pt-2">
				<Button onclick={handleSubmit} disabled={!canSubmit} class="flex-1">
					{#if isSubmitting}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						Submitting...
					{:else}
						Submit Ticket
					{/if}
				</Button>
				<Button variant="outline" onclick={handleCancel} disabled={isSubmitting}>Cancel</Button>
			</div>
		</div>
	{/if}
</div>
