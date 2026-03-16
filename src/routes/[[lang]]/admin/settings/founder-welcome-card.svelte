<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { toast } from 'svelte-sonner';
	import { tick } from 'svelte';
	import { FOUNDER_WELCOME_DEFAULTS } from '$lib/convex/emails/helpers.js';

	const { t } = getTranslate();
	const client = useConvexClient();
	const viewer = useQuery(api.users.viewer);
	const result = useQuery(api.admin.founderWelcome.queries.getFounderWelcomeConfig, {});

	let dialogOpen = $state(false);
	let editName = $state('');
	let editTitle = $state('');
	let editSubject = $state('');
	let editBody = $state('');
	let isSaving = $state(false);
	let isStepping = $state(false);
	let showStepDownConfirm = $state(false);
	let editingBody = $state(false);

	const config = $derived(result.data?.config);
	const viewerProfile = $derived(result.data?.viewerProfile);
	const isEnabled = $derived(config?.enabled === true);
	const isContactPerson = $derived(config?.enabled && config.contactUser.id === viewer.data?._id);
	const isSomeoneElseContact = $derived(
		config?.enabled && config.contactUser.id !== viewer.data?._id
	);

	const canSave = $derived(
		editName.trim() !== '' &&
			editTitle.trim() !== '' &&
			editSubject.trim() !== '' &&
			editBody.trim() !== ''
	);

	// Live preview with sample data
	const previewText = $derived.by(() => {
		const template = editBody || '';
		return template
			.replace(/\{\{userName\}\}/g, 'Alex')
			.replace(/\{\{founderName\}\}/g, editName || 'You')
			.replace(/\{\{founderTitle\}\}/g, editTitle || 'Founder');
	});

	function openDialog() {
		// Pre-fill with viewer's own profile (name/title persist per-user)
		if (viewerProfile) {
			editName = viewerProfile.name;
			editTitle = viewerProfile.title;
		}
		// Pre-fill email from global config or defaults
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
		isStepping = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.stepDown, {});
			dialogOpen = false;
			showStepDownConfirm = false;
			toast.success($t('admin.settings.founder_welcome.stepped_down'));
		} catch (error) {
			console.error('Failed to step down:', error);
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isStepping = false;
		}
	}

	function handleDialogOpenChange(open: boolean) {
		dialogOpen = open;
		if (!open) {
			showStepDownConfirm = false;
			editingBody = false;
		}
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
		{#if !result.data}
			<div class="text-muted-foreground text-sm">...</div>
		{:else if !isEnabled}
			<div class="w-full space-y-4">
				<p class="text-muted-foreground text-sm">
					<T keyName="admin.settings.founder_welcome.not_configured" />
				</p>
				<Button size="sm" onclick={openDialog}>
					<T keyName="admin.settings.founder_welcome.setup_button" />
				</Button>
			</div>
		{:else if isSomeoneElseContact && config?.enabled}
			<div class="w-full space-y-4">
				<div>
					<p class="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
						<T keyName="admin.settings.founder_welcome.contact_person" />
					</p>
					<p class="text-sm">
						<T
							keyName="admin.settings.founder_welcome.contact_person_info"
							params={{
								name: config.contactUser.name,
								email: config.contactUser.email
							}}
						/>
					</p>
				</div>
				<Button size="sm" variant="outline" onclick={openDialog}>
					<T keyName="admin.settings.founder_welcome.take_over" />
				</Button>
			</div>
		{:else if isContactPerson}
			<Button size="sm" variant="outline" onclick={openDialog}>
				<T keyName="admin.settings.founder_welcome.edit_button" />
			</Button>
		{/if}
	</Item.Footer>
</Item.Root>

<Dialog.Root open={dialogOpen} onOpenChange={handleDialogOpenChange}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title><T keyName="admin.settings.founder_welcome.title" /></Dialog.Title>
			<Dialog.Description>
				<T keyName="admin.settings.founder_welcome.description" />
			</Dialog.Description>
		</Dialog.Header>

		<Field.Group>
			<Field.Field>
				<Field.Label for="config-name">
					<T keyName="admin.settings.founder_welcome.config_name_label" />
				</Field.Label>
				<Input id="config-name" bind:value={editName} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="config-title">
					<T keyName="admin.settings.founder_welcome.config_title_label" />
				</Field.Label>
				<Input
					id="config-title"
					placeholder={$t('admin.settings.founder_welcome.setup_title_placeholder')}
					bind:value={editTitle}
				/>
			</Field.Field>
			<Field.Field>
				<Field.Label for="config-subject">
					<T keyName="admin.settings.founder_welcome.config_subject_label" />
				</Field.Label>
				<Input id="config-subject" bind:value={editSubject} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="config-body">
					<T keyName="admin.settings.founder_welcome.config_body_label" />
				</Field.Label>
				{#if editingBody || !editBody}
					<Textarea
						id="config-body"
						rows={8}
						bind:value={editBody}
						onfocus={() => {
							editingBody = true;
						}}
						onblur={async () => {
							if (!editBody) return;
							editingBody = false;
							await tick();
							document.getElementById('config-body-preview')?.focus();
						}}
					/>
					<Field.Description>
						<T keyName="admin.settings.founder_welcome.variables_label" />
						{' {{userName}}, {{founderName}}, {{founderTitle}}'}
					</Field.Description>
				{:else}
					<button
						id="config-body-preview"
						type="button"
						class="bg-muted/30 max-h-60 w-full cursor-text overflow-y-auto rounded-md border p-3 text-left text-sm"
						onclick={async () => {
							editingBody = true;
							await tick();
							const el = document.getElementById('config-body') as HTMLTextAreaElement | null;
							el?.focus();
						}}
					>
						<p class="whitespace-pre-wrap">{previewText}</p>
					</button>
				{/if}
			</Field.Field>
		</Field.Group>

		<Dialog.Footer
			class="flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<div>
				{#if isContactPerson}
					{#if showStepDownConfirm}
						<div class="flex items-center gap-2">
							<Button
								size="sm"
								variant="destructive"
								onclick={handleStepDown}
								disabled={isStepping}
							>
								<T keyName="admin.settings.founder_welcome.step_down" />
							</Button>
							<Button size="sm" variant="ghost" onclick={() => (showStepDownConfirm = false)}>
								<T keyName="admin.settings.founder_welcome.cancel" />
							</Button>
						</div>
						<p class="text-muted-foreground mt-1 text-sm">
							<T keyName="admin.settings.founder_welcome.step_down_confirm" />
						</p>
					{:else}
						<Button size="sm" variant="ghost" onclick={() => (showStepDownConfirm = true)}>
							<T keyName="admin.settings.founder_welcome.step_down" />
						</Button>
					{/if}
				{/if}
			</div>
			<Button onclick={handleSave} disabled={isSaving || !canSave}>
				{#if isContactPerson}
					<T keyName="admin.settings.founder_welcome.save" />
				{:else}
					<T keyName="admin.settings.founder_welcome.setup_button" />
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
