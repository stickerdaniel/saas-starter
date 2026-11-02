<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '#lib/convex/_generated/api.js';
	import * as Item from '#lib/components/ui/item/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import FounderResetConfirmAction from '#lib/components/ui/owned/founder-reset-confirm-action.svelte';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { toast } from 'svelte-sonner';
	import { safeParse } from 'valibot';
	import { emailSchema } from '#lib/schemas/auth.js';
	import { translateFormError } from '#lib/utils/validation-i18n.js';
	import type { FounderEmail } from '#lib/convex/emails/founderEmailConfig.js';
	import type { FounderTemplateVariables } from '#lib/convex/emails/founderTemplate.js';
	import FounderBodyEditor from './founder-body-editor.svelte';

	let { email }: { email: FounderEmail } = $props();

	const EMAILS = {
		welcome: {
			idPrefix: 'founder-welcome',
			titleKey: 'admin.settings.founder_welcome.welcome_title',
			descriptionKey: 'admin.settings.founder_welcome.welcome_description'
		},
		feedback: {
			idPrefix: 'founder-feedback',
			titleKey: 'admin.settings.founder_welcome.feedback_title',
			descriptionKey: 'admin.settings.founder_welcome.feedback_description'
		},
		cancellation: {
			idPrefix: 'founder-cancellation',
			titleKey: 'admin.settings.founder_welcome.cancellation_title',
			descriptionKey: 'admin.settings.founder_welcome.cancellation_description'
		}
	} as const;

	const { t } = getTranslate();
	const client = useConvexClient();
	const viewer = useQuery(api.users.viewer);
	const result = useQuery(api.admin.founderWelcome.queries.getFounderEmailConfigs, {});

	let dialogOpen = $state(false);
	let editName = $state('');
	let editTitle = $state('');
	let editReplyTo = $state('');
	let editSubject = $state('');
	let editBody = $state('');
	let isSaving = $state(false);
	let isStopping = $state(false);
	let stopDialogOpen = $state(false);

	const copy = $derived(EMAILS[email]);
	const config = $derived(result.data?.[email]);
	const isOn = $derived(config?.senderUserId != null);
	const isSender = $derived(isOn && config?.senderUserId === viewer.data?._id);

	// Reply-to is optional: empty is valid, anything else must be a valid email
	const replyToError = $derived.by(() => {
		const value = editReplyTo.trim();
		if (!value) return undefined;
		return safeParse(emailSchema, value).success ? undefined : 'validation.email.invalid';
	});

	const canSave = $derived(
		editName.trim() !== '' &&
			editTitle.trim() !== '' &&
			editSubject.trim() !== '' &&
			editBody.trim() !== '' &&
			!replyToError
	);

	// Sample recipient values for the body preview
	const previewVars = $derived<FounderTemplateVariables>({
		userFirstName: 'Alex',
		userLastName: 'Johnson',
		founderName: editName || 'You',
		founderTitle: editTitle || 'Founder'
	});

	function openDialog() {
		// The query pre-fills the current sender's values, or the viewer's own
		if (config) {
			editName = config.name;
			editTitle = config.title;
			editReplyTo = config.replyTo;
			editSubject = config.subject;
			editBody = config.body;
		}
		dialogOpen = true;
	}

	async function handleSave() {
		isSaving = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.updateEmailConfig, {
				email,
				name: editName,
				title: editTitle,
				replyTo: editReplyTo.trim() || undefined,
				subject: editSubject,
				body: editBody
			});
			dialogOpen = false;
			toast.success($t('admin.settings.founder_welcome.saved'));
		} catch (error) {
			console.error('Failed to save founder email config:', error);
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isSaving = false;
		}
	}

	async function handleStop() {
		if (isStopping) return;
		isStopping = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.disableEmail, { email });
			stopDialogOpen = false;
			dialogOpen = false;
			toast.success($t('admin.settings.founder_welcome.stopped_sending'));
		} catch (error) {
			console.error('Failed to stop founder email:', error);
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isStopping = false;
		}
	}

	// A stop in flight cannot be dismissed, so its outcome stays visible.
	function blockWhileStopping(event: Event) {
		if (isStopping) event.preventDefault();
	}

	function handleDialogOpenChange(open: boolean) {
		dialogOpen = open;
		if (!open) {
			stopDialogOpen = false;
		}
	}
</script>

<Item.Root variant="outline" data-testid="{copy.idPrefix}-card">
	<Item.Content>
		<Item.Title><T keyName={copy.titleKey} /></Item.Title>
		<Item.Description>
			<T keyName={copy.descriptionKey} />
		</Item.Description>
	</Item.Content>
	<Item.Footer>
		{#if result.error}
			<p class="text-sm text-destructive" data-testid="{copy.idPrefix}-error">
				<T keyName="common.load_error" />
			</p>
		{:else if !config}
			<Button size="sm" variant="outline" class="invisible">&nbsp;</Button>
		{:else}
			<p class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
				<span
					aria-hidden="true"
					class={['size-2 shrink-0 rounded-full', isOn ? 'bg-primary' : 'bg-muted-foreground/40']}
				></span>
				<span class="truncate">
					{#if isOn}
						<T keyName="admin.settings.founder_welcome.status_on" params={{ name: config.name }} />
					{:else}
						<T keyName="admin.settings.founder_welcome.status_off" />
					{/if}
				</span>
			</p>
			{#if !isOn}
				<Button size="sm" onclick={openDialog}>
					<T keyName="admin.settings.founder_welcome.become_sender" />
				</Button>
			{:else}
				<Button size="sm" variant="outline" onclick={openDialog} disabled={!isSender}>
					<T keyName="admin.settings.founder_welcome.edit_button" />
				</Button>
			{/if}
		{/if}
	</Item.Footer>
</Item.Root>

<Dialog.Root open={dialogOpen} onOpenChange={handleDialogOpenChange}>
	<Dialog.Content
		class="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden sm:max-w-lg"
	>
		<Dialog.Header>
			<Dialog.Title><T keyName={copy.titleKey} /></Dialog.Title>
			<Dialog.Description>
				<T keyName={copy.descriptionKey} />
			</Dialog.Description>
		</Dialog.Header>

		<!-- The footer cancels the section gap so scrolled content meets its divider;
		     the padding puts that gap back below the last field. -->
		<div class="-mx-1 min-h-0 overflow-y-auto px-1 pb-(--dialog-gap)">
			<Field.Group>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Field.Field>
						<Field.Label for="{copy.idPrefix}-name">
							<T keyName="admin.settings.founder_welcome.config_name_label" />
						</Field.Label>
						<Input id="{copy.idPrefix}-name" bind:value={editName} />
					</Field.Field>
					<Field.Field>
						<Field.Label for="{copy.idPrefix}-title">
							<T keyName="admin.settings.founder_welcome.config_title_label" />
						</Field.Label>
						<Input
							id="{copy.idPrefix}-title"
							placeholder={$t('admin.settings.founder_welcome.setup_title_placeholder')}
							bind:value={editTitle}
						/>
					</Field.Field>
				</div>
				<Field.Field>
					<Field.Label for="{copy.idPrefix}-reply-to">
						<T keyName="admin.settings.founder_welcome.config_reply_to_label" />
					</Field.Label>
					<Input
						id="{copy.idPrefix}-reply-to"
						type="email"
						placeholder={$t('admin.settings.founder_welcome.config_reply_to_placeholder')}
						bind:value={editReplyTo}
						aria-invalid={replyToError ? 'true' : undefined}
						aria-describedby={replyToError ? `${copy.idPrefix}-reply-to-error` : undefined}
					/>
					<Field.Error
						id="{copy.idPrefix}-reply-to-error"
						errors={translateFormError(replyToError, $t)}
					/>
				</Field.Field>
				<Field.Field>
					<Field.Label for="{copy.idPrefix}-subject">
						<T keyName="admin.settings.founder_welcome.config_subject_label" />
					</Field.Label>
					<Input id="{copy.idPrefix}-subject" bind:value={editSubject} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="{copy.idPrefix}-body">
						<T keyName="admin.settings.founder_welcome.config_body_label" />
					</Field.Label>
					<FounderBodyEditor id="{copy.idPrefix}-body" bind:value={editBody} {previewVars} />
				</Field.Field>
			</Field.Group>
		</div>

		<Dialog.Footer
			class="-mt-(--dialog-gap) flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<div>
				{#if isSender}
					<AlertDialog.Root bind:open={stopDialogOpen}>
						<AlertDialog.Trigger>
							{#snippet child({ props })}
								<Button size="sm" variant="ghost" {...props}>
									<T keyName="admin.settings.founder_welcome.stop_sending" />
								</Button>
							{/snippet}
						</AlertDialog.Trigger>
						<AlertDialog.Content
							onEscapeKeydown={blockWhileStopping}
							onInteractOutside={blockWhileStopping}
						>
							<AlertDialog.Header>
								<AlertDialog.Title>
									<T keyName="admin.settings.founder_welcome.stop_sending" />
								</AlertDialog.Title>
								<AlertDialog.Description>
									<T keyName="admin.settings.founder_welcome.stop_sending_confirm" />
								</AlertDialog.Description>
							</AlertDialog.Header>
							<AlertDialog.Footer>
								<AlertDialog.Cancel disabled={isStopping}>
									<T keyName="admin.settings.founder_welcome.cancel" />
								</AlertDialog.Cancel>
								<FounderResetConfirmAction onclick={handleStop} disabled={isStopping}>
									<T keyName="admin.settings.founder_welcome.stop_sending" />
								</FounderResetConfirmAction>
							</AlertDialog.Footer>
						</AlertDialog.Content>
					</AlertDialog.Root>
				{/if}
			</div>
			<Button onclick={handleSave} disabled={isSaving || !canSave}>
				{#if isSender}
					<T keyName="admin.settings.founder_welcome.save" />
				{:else}
					<T keyName="admin.settings.founder_welcome.become_sender" />
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
