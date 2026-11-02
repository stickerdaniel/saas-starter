<script lang="ts">
	import type { Snippet } from 'svelte';
	import { T } from '@tolgee/svelte';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import type { FounderTemplateVariables } from '#lib/convex/emails/founderTemplate.js';
	import FounderBodyEditor from './founder-body-editor.svelte';

	/**
	 * The edit dialog of every founder email card: optional `fields` above the subject
	 * and body, the body preview filled with `previewVars`, and the save button.
	 * `footerStart` sits left of the save button. Field ids start with `idPrefix`.
	 */
	let {
		open = $bindable(false),
		onOpenChange,
		idPrefix,
		titleKey,
		descriptionKey,
		subject = $bindable(),
		body = $bindable(),
		previewVars,
		canSave,
		isSaving,
		saveKey,
		onSave,
		fields,
		footerStart
	}: {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		idPrefix: string;
		titleKey: string;
		descriptionKey: string;
		subject: string;
		body: string;
		previewVars: FounderTemplateVariables;
		canSave: boolean;
		isSaving: boolean;
		saveKey: string;
		onSave: () => void;
		fields?: Snippet;
		footerStart?: Snippet;
	} = $props();
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content
		class="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden sm:max-w-lg"
	>
		<Dialog.Header>
			<Dialog.Title><T keyName={titleKey} /></Dialog.Title>
			<Dialog.Description><T keyName={descriptionKey} /></Dialog.Description>
		</Dialog.Header>

		<!-- The footer cancels the section gap so scrolled content meets its divider;
		     the padding puts that gap back below the last field. -->
		<div class="-mx-1 min-h-0 overflow-y-auto px-1 pb-(--dialog-gap)">
			<Field.Group>
				{@render fields?.()}
				<Field.Field>
					<Field.Label for="{idPrefix}-subject">
						<T keyName="admin.settings.founder_welcome.config_subject_label" />
					</Field.Label>
					<Input id="{idPrefix}-subject" bind:value={subject} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="{idPrefix}-body">
						<T keyName="admin.settings.founder_welcome.config_body_label" />
					</Field.Label>
					<FounderBodyEditor id="{idPrefix}-body" bind:value={body} {previewVars} />
				</Field.Field>
			</Field.Group>
		</div>

		<Dialog.Footer
			class="-mt-(--dialog-gap) flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between"
		>
			{@render footerStart?.()}
			<Button class="sm:ml-auto" onclick={onSave} disabled={isSaving || !canSave}>
				<T keyName={saveKey} />
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
