<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '#lib/convex/_generated/api.js';
	import * as Item from '#lib/components/ui/item/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { toast } from 'svelte-sonner';
	import type { SwitchableFounderEmail } from '#lib/convex/emails/founderEmailConfig.js';
	import type { FounderTemplateVariables } from '#lib/convex/emails/founderTemplate.js';
	import FounderBodyEditor from './founder-body-editor.svelte';

	/**
	 * The card of a founder email beside the welcome: its switch and template. It
	 * goes out as the welcome's contact person, who alone may change it.
	 */
	let { email }: { email: SwitchableFounderEmail } = $props();

	const EMAILS = {
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
	const result = useQuery(api.admin.founderWelcome.queries.getFounderEmailSettings, {});

	let dialogOpen = $state(false);
	let editSubject = $state('');
	let editBody = $state('');
	let isSaving = $state(false);
	let isSwitching = $state(false);

	const copy = $derived(EMAILS[email]);
	const settings = $derived(result.data);
	const emailSettings = $derived(settings?.[email]);
	const sender = $derived(settings?.sender ?? null);
	const isSending = $derived(sender !== null && emailSettings?.on === true);

	const canSave = $derived(editSubject.trim() !== '' && editBody.trim() !== '');

	// Sample recipient values for the body preview
	const previewVars = $derived<FounderTemplateVariables>({
		userFirstName: 'Alex',
		userLastName: 'Johnson',
		founderName: sender?.name || 'You',
		founderTitle: sender?.title || 'Founder'
	});

	function openDialog() {
		if (emailSettings) {
			editSubject = emailSettings.subject;
			editBody = emailSettings.body;
		}
		dialogOpen = true;
	}

	async function handleSave() {
		isSaving = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.updateFounderEmailTemplate, {
				email,
				subject: editSubject,
				body: editBody
			});
			dialogOpen = false;
			toast.success($t('admin.settings.founder_welcome.template_saved'));
		} catch (error) {
			console.error('Failed to save founder email template:', error);
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isSaving = false;
		}
	}

	// Bound through a getter so the switch always shows the stored state, also when
	// the change failed.
	async function handleSwitch(enabled: boolean) {
		if (isSwitching) return;
		isSwitching = true;
		try {
			await client.mutation(api.admin.founderWelcome.mutations.setFounderEmailEnabled, {
				email,
				enabled
			});
			toast.success(
				$t(
					enabled
						? 'admin.settings.founder_welcome.switched_on'
						: 'admin.settings.founder_welcome.switched_off'
				)
			);
		} catch (error) {
			console.error('Failed to switch founder email:', error);
			toast.error($t('admin.settings.founder_welcome.error'));
		} finally {
			isSwitching = false;
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
		{:else if !settings || !emailSettings}
			<Button size="sm" variant="outline" class="invisible">&nbsp;</Button>
		{:else}
			<p class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
				<span
					aria-hidden="true"
					class={[
						'size-2 shrink-0 rounded-full',
						isSending ? 'bg-primary' : 'bg-muted-foreground/40'
					]}
				></span>
				<span class="truncate">
					{#if !sender}
						<T keyName="admin.settings.founder_welcome.needs_contact" />
					{:else if isSending}
						<T keyName="admin.settings.founder_welcome.status_on" params={{ name: sender.name }} />
					{:else}
						<T keyName="admin.settings.founder_welcome.status_off" />
					{/if}
				</span>
			</p>
			<div class="flex shrink-0 items-center gap-3">
				<Button size="sm" variant="outline" onclick={openDialog} disabled={!settings.canEdit}>
					<T keyName="admin.settings.founder_welcome.edit_button" />
				</Button>
				<Switch
					aria-label={$t('admin.settings.founder_welcome.switch_label')}
					bind:checked={() => emailSettings.on, handleSwitch}
					disabled={!settings.canEdit || isSwitching}
				/>
			</div>
		{/if}
	</Item.Footer>
</Item.Root>

<Dialog.Root bind:open={dialogOpen}>
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

		<Dialog.Footer class="-mt-(--dialog-gap)">
			<Button onclick={handleSave} disabled={isSaving || !canSave}>
				<T keyName="admin.settings.founder_welcome.save" />
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
