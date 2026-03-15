<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { toast } from 'svelte-sonner';

	const { t } = getTranslate();
	const client = useConvexClient();
	const viewer = useQuery(api.users.viewer);
	const config = useQuery(api.admin.founderWelcome.queries.getFounderWelcomeConfig, {});

	let setupTitle = $state('');
	let editTitle = $state('');
	let editSubject = $state('');
	let editBody = $state('');
	let isSettingUp = $state(false);
	let isSaving = $state(false);
	let isStepping = $state(false);
	let isTakingOver = $state(false);
	let showSetupForm = $state(false);
	let showStepDownConfirm = $state(false);

	// Sync edit fields when config loads
	$effect(() => {
		const c = config.data;
		if (c?.enabled) {
			editTitle = c.title;
			editSubject = c.subject;
			editBody = c.body;
		}
	});

	const currentUserId = $derived(viewer.data?._id);
	const isContactPerson = $derived(
		config.data?.enabled && config.data.contactUser.id === currentUserId
	);
	const isSomeoneElseContact = $derived(
		config.data?.enabled && config.data.contactUser.id !== currentUserId
	);
	const canSave = $derived(
		editTitle.trim() !== '' && editSubject.trim() !== '' && editBody.trim() !== ''
	);

	// Live preview with sample data
	const previewText = $derived.by(() => {
		const template = editBody || '';
		return template
			.replace(/\{\{userName\}\}/g, 'Alex')
			.replace(/\{\{founderName\}\}/g, viewer.data?.name || 'You')
			.replace(/\{\{founderTitle\}\}/g, editTitle || 'Founder');
	});

	const previewSubject = $derived.by(() => {
		const template = editSubject || '';
		return template
			.replace(/\{\{userName\}\}/g, 'Alex')
			.replace(/\{\{founderName\}\}/g, viewer.data?.name || 'You')
			.replace(/\{\{founderTitle\}\}/g, editTitle || 'Founder');
	});

	async function handleBecomeContact() {
		if (!setupTitle.trim()) return;
		isSettingUp = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.becomeContactPerson, {
				title: setupTitle
			});
			showSetupForm = false;
			setupTitle = '';
			toast.success($t('admin.settings.founder_welcome.became_contact'));
		} catch {
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isSettingUp = false;
		}
	}

	async function handleTakeOver() {
		isTakingOver = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.becomeContactPerson, {});
			toast.success($t('admin.settings.founder_welcome.took_over'));
		} catch {
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isTakingOver = false;
		}
	}

	async function handleSave() {
		isSaving = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.updateConfig, {
				title: editTitle,
				subject: editSubject,
				body: editBody
			});
			toast.success($t('admin.settings.founder_welcome.saved'));
		} catch {
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isSaving = false;
		}
	}

	async function handleStepDown() {
		isStepping = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.stepDown, {});
			toast.success($t('admin.settings.founder_welcome.stepped_down'));
		} catch {
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isStepping = false;
		}
	}
</script>

<Item.Root variant="outline" data-testid="founder-welcome-card">
	<Item.Content>
		<Item.Title><T keyName="admin.settings.founder_welcome.title" /></Item.Title>
		<Item.Description class="line-clamp-none">
			<T keyName="admin.settings.founder_welcome.description" />
		</Item.Description>
	</Item.Content>
	<Item.Footer>
		{#if !config.data}
			<!-- Loading state -->
			<div class="text-muted-foreground text-sm">...</div>
		{:else if !config.data.enabled}
			<!-- State 1: Not configured -->
			<div class="w-full space-y-4">
				<p class="text-muted-foreground text-sm">
					<T keyName="admin.settings.founder_welcome.not_configured" />
				</p>

				{#if showSetupForm}
					<Field.Group>
						<Field.Field>
							<Field.Label for="setup-title">
								<T keyName="admin.settings.founder_welcome.setup_title_label" />
							</Field.Label>
							<Input
								id="setup-title"
								placeholder={$t('admin.settings.founder_welcome.setup_title_placeholder')}
								bind:value={setupTitle}
							/>
						</Field.Field>
					</Field.Group>
					<div class="flex gap-2">
						<Button
							size="sm"
							onclick={handleBecomeContact}
							disabled={isSettingUp || !setupTitle.trim()}
						>
							{#if isSettingUp}
								...
							{:else}
								<T keyName="admin.settings.founder_welcome.setup_confirm" />
							{/if}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onclick={() => {
								showSetupForm = false;
								setupTitle = '';
							}}
						>
							<T keyName="admin.settings.founder_welcome.cancel" />
						</Button>
					</div>
				{:else}
					<Button size="sm" onclick={() => (showSetupForm = true)}>
						<T keyName="admin.settings.founder_welcome.setup_button" />
					</Button>
				{/if}
			</div>
		{:else if isSomeoneElseContact}
			<!-- State 2: Someone else is the contact person -->
			<div class="w-full space-y-4">
				<div>
					<p class="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
						<T keyName="admin.settings.founder_welcome.contact_person" />
					</p>
					<p class="text-sm">
						<T
							keyName="admin.settings.founder_welcome.contact_person_info"
							params={{
								name: config.data.contactUser.name,
								email: config.data.contactUser.email
							}}
						/>
					</p>
				</div>
				<p class="text-muted-foreground text-sm">
					<T keyName="admin.settings.founder_welcome.take_over_confirm" />
				</p>
				<Button size="sm" variant="outline" onclick={handleTakeOver} disabled={isTakingOver}>
					<T keyName="admin.settings.founder_welcome.take_over" />
				</Button>
			</div>
		{:else if isContactPerson}
			<!-- State 3: You are the contact person -->
			<div class="w-full space-y-6">
				<Field.Group>
					<Field.Field>
						<Field.Label for="config-title">
							<T keyName="admin.settings.founder_welcome.config_title_label" />
						</Field.Label>
						<Input id="config-title" bind:value={editTitle} />
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
						<Textarea id="config-body" rows={6} bind:value={editBody} />
						<Field.Description>
							<T keyName="admin.settings.founder_welcome.config_variables_hint" />
						</Field.Description>
					</Field.Field>
				</Field.Group>

				<div class="flex items-center gap-2">
					<Button size="sm" onclick={handleSave} disabled={isSaving || !canSave}>
						<T keyName="admin.settings.founder_welcome.save" />
					</Button>
					{#if showStepDownConfirm}
						<Button size="sm" variant="destructive" onclick={handleStepDown} disabled={isStepping}>
							<T keyName="admin.settings.founder_welcome.setup_confirm" />
						</Button>
						<Button size="sm" variant="ghost" onclick={() => (showStepDownConfirm = false)}>
							<T keyName="admin.settings.founder_welcome.cancel" />
						</Button>
					{:else}
						<Button size="sm" variant="ghost" onclick={() => (showStepDownConfirm = true)}>
							<T keyName="admin.settings.founder_welcome.step_down" />
						</Button>
					{/if}
				</div>
				{#if showStepDownConfirm}
					<p class="text-muted-foreground text-sm">
						<T keyName="admin.settings.founder_welcome.step_down_confirm" />
					</p>
				{/if}

				<!-- Live preview -->
				<Separator />
				<div>
					<p class="mb-3 text-sm font-medium">
						<T keyName="admin.settings.founder_welcome.preview_title" />
					</p>
					<div class="bg-muted/50 rounded-lg border p-4">
						<p class="text-muted-foreground mb-2 text-xs font-medium">
							<T keyName="admin.settings.founder_welcome.preview_subject" />:
							<span class="text-foreground">{previewSubject}</span>
						</p>
						<p class="whitespace-pre-wrap text-sm">{previewText}</p>
					</div>
				</div>
			</div>
		{/if}
	</Item.Footer>
</Item.Root>
