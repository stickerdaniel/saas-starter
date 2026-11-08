<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '#lib/convex/_generated/api.js';
	import * as Item from '#lib/components/ui/item/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import FounderResetConfirmAction from '#lib/components/ui/owned/founder-reset-confirm-action.svelte';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { toast } from 'svelte-sonner';
	import { safeParse } from 'valibot';
	import { emailSchema } from '#lib/schemas/auth.js';
	import { translateFormError } from '#lib/utils/validation-i18n.js';
	import { FOUNDER_WELCOME_DEFAULTS } from '#lib/convex/emails/helpers.js';
	import type { FounderTemplateVariables } from '#lib/convex/emails/founderTemplate.js';
	import FounderEmailDialog from './founder-email-dialog.svelte';
	import FounderEmailStatus from './founder-email-status.svelte';

	const { t } = getTranslate();
	const client = useConvexClient();
	const viewer = useQuery(api.users.viewer);
	const result = useQuery(api.admin.founderWelcome.queries.getFounderWelcomeConfig, {});

	let dialogOpen = $state(false);
	let editName = $state('');
	let editTitle = $state('');
	let editReplyTo = $state('');
	let editSubject = $state('');
	let editBody = $state('');
	let isSaving = $state(false);
	let isStepping = $state(false);
	let stepDownDialogOpen = $state(false);

	const config = $derived(result.data?.config);
	const viewerProfile = $derived(result.data?.viewerProfile);
	const isEnabled = $derived(config?.enabled === true);
	const isContactPerson = $derived(config?.enabled && config.contactUser.id === viewer.data?._id);

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
		// Pre-fill with viewer's own profile (name/title/replyTo persist per-user)
		if (viewerProfile) {
			editName = viewerProfile.name;
			editTitle = viewerProfile.title;
			editReplyTo = viewerProfile.replyTo;
		}
		// Pre-fill subject/body from global config or defaults
		if (config?.enabled) {
			editSubject = config.subject;
			editBody = config.body;
		} else {
			editSubject = FOUNDER_WELCOME_DEFAULTS.subject;
			editBody = FOUNDER_WELCOME_DEFAULTS.body;
		}
		dialogOpen = true;
	}

	async function handleSave() {
		isSaving = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.updateConfig, {
				name: editName,
				title: editTitle,
				replyTo: editReplyTo.trim() || undefined,
				subject: editSubject,
				body: editBody
			});
			dialogOpen = false;
			toast.success($t('admin.settings.founder_welcome.saved'));
		} catch (error) {
			console.error('Failed to save founder welcome config:', error);
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isSaving = false;
		}
	}

	async function handleStepDown() {
		if (isStepping) return;
		isStepping = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.stepDown, {});
			stepDownDialogOpen = false;
			dialogOpen = false;
			toast.success($t('admin.settings.founder_welcome.stepped_down'));
		} catch (error) {
			console.error('Failed to step down:', error);
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isStepping = false;
		}
	}

	function blockWhileStepping(event: Event) {
		if (isStepping) event.preventDefault();
	}

	function closeStepDownWithDialog(open: boolean) {
		if (!open) stepDownDialogOpen = false;
	}
</script>

<Item.Root variant="outline" data-testid="founder-welcome-card">
	<Item.Content>
		<Item.Title><T keyName="admin.settings.founder_welcome.title" /></Item.Title>
		<Item.Description>
			<T keyName="admin.settings.founder_welcome.description" />
		</Item.Description>
	</Item.Content>
	<Item.Footer>
		{#if result.error}
			<p class="text-sm text-destructive" data-testid="founder-welcome-error">
				<T keyName="common.load_error" />
			</p>
		{:else if !result.data}
			<Button size="sm" variant="outline" class="invisible">&nbsp;</Button>
		{:else}
			<FounderEmailStatus sending={isEnabled}>
				{#if config?.enabled}
					<T keyName="admin.settings.founder_welcome.status_on" params={{ name: config.name }} />
				{:else}
					<T keyName="admin.settings.founder_welcome.status_off" />
				{/if}
			</FounderEmailStatus>
			{#if isEnabled}
				<Button size="sm" variant="outline" onclick={openDialog} disabled={!isContactPerson}>
					<T keyName="admin.settings.founder_welcome.edit_button" />
				</Button>
			{:else}
				<Button size="sm" onclick={openDialog}>
					<T keyName="admin.settings.founder_welcome.setup_button" />
				</Button>
			{/if}
		{/if}
	</Item.Footer>
</Item.Root>

<FounderEmailDialog
	bind:open={dialogOpen}
	onOpenChange={closeStepDownWithDialog}
	bind:subject={editSubject}
	bind:body={editBody}
	idPrefix="founder-welcome"
	titleKey="admin.settings.founder_welcome.title"
	descriptionKey="admin.settings.founder_welcome.description"
	{previewVars}
	{canSave}
	{isSaving}
	saveKey={isContactPerson
		? 'admin.settings.founder_welcome.save'
		: 'admin.settings.founder_welcome.setup_button'}
	onSave={handleSave}
>
	{#snippet fields()}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<Field.Field>
				<Field.Label for="founder-welcome-name">
					<T keyName="admin.settings.founder_welcome.config_name_label" />
				</Field.Label>
				<Input id="founder-welcome-name" bind:value={editName} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="founder-welcome-title">
					<T keyName="admin.settings.founder_welcome.config_title_label" />
				</Field.Label>
				<Input
					id="founder-welcome-title"
					placeholder={$t('admin.settings.founder_welcome.setup_title_placeholder')}
					bind:value={editTitle}
				/>
			</Field.Field>
		</div>
		<Field.Field>
			<Field.Label for="founder-welcome-reply-to">
				<T keyName="admin.settings.founder_welcome.config_reply_to_label" />
			</Field.Label>
			<Input
				id="founder-welcome-reply-to"
				type="email"
				placeholder={$t('admin.settings.founder_welcome.config_reply_to_placeholder')}
				bind:value={editReplyTo}
				aria-invalid={replyToError ? 'true' : undefined}
				aria-describedby={replyToError ? 'founder-welcome-reply-to-error' : undefined}
			/>
			<Field.Error
				id="founder-welcome-reply-to-error"
				errors={translateFormError(replyToError, $t)}
			/>
		</Field.Field>
	{/snippet}
	{#snippet footerStart()}
		{#if isContactPerson}
			<AlertDialog.Root bind:open={stepDownDialogOpen}>
				<AlertDialog.Trigger>
					{#snippet child({ props })}
						<Button size="sm" variant="ghost" {...props}>
							<T keyName="admin.settings.founder_welcome.step_down" />
						</Button>
					{/snippet}
				</AlertDialog.Trigger>
				<AlertDialog.Content
					onEscapeKeydown={blockWhileStepping}
					onInteractOutside={blockWhileStepping}
				>
					<AlertDialog.Header>
						<AlertDialog.Title>
							<T keyName="admin.settings.founder_welcome.step_down" />
						</AlertDialog.Title>
						<AlertDialog.Description>
							<T keyName="admin.settings.founder_welcome.step_down_confirm" />
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel disabled={isStepping}>
							<T keyName="admin.settings.founder_welcome.cancel" />
						</AlertDialog.Cancel>
						<FounderResetConfirmAction onclick={handleStepDown} disabled={isStepping}>
							<T keyName="admin.settings.founder_welcome.step_down" />
						</FounderResetConfirmAction>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>
		{/if}
	{/snippet}
</FounderEmailDialog>
