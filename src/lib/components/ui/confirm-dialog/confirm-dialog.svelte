<script lang="ts" module>
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';

	export type ConfirmOptions = {
		title: string;
		description: string;
		confirmText: string;
		tone: 'destructive' | 'default';
		field?: { label: string; placeholder: string };
		/** Rejecting keeps the dialog open; callers surface their own error first. */
		onConfirm: (value: string) => Promise<unknown>;
	};

	class ConfirmDialogState {
		open = $state(false);
		options = $state.raw<ConfirmOptions | null>(null);
		value = $state('');
		pending = $state(false);
		// Bumped by every new confirmation and by reset, so an older settlement is ignored.
		#session = 0;

		show(options: ConfirmOptions) {
			if (this.pending) return;
			this.#session++;
			this.options = options;
			this.value = '';
			this.open = true;
		}

		async submit() {
			const options = this.options;
			if (!options || this.pending) return;
			const session = this.#session;
			this.pending = true;
			haptic.trigger('warning');
			try {
				await options.onConfirm(this.value);
				if (session === this.#session) this.open = false;
			} catch (error) {
				// Stays open so the user can retry after the caller's own toast.
				console.error('[confirm-dialog] onConfirm failed:', error);
			} finally {
				if (session === this.#session) this.pending = false;
			}
		}

		reset() {
			this.#session++;
			this.open = false;
			this.pending = false;
			this.options = null;
			this.value = '';
		}
	}

	const dialogState = new ConfirmDialogState();

	/** Opens the confirmation rendered by the page's `<ConfirmDialog />`. */
	export function confirm(options: ConfirmOptions) {
		dialogState.show(options);
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { getTranslate } from '@tolgee/svelte';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	const { t } = getTranslate();
	const fieldId = $props.id();

	// The host owns the confirmation: leaving its page drops it.
	onMount(() => () => dialogState.reset());

	function blockWhilePending(event: Event) {
		if (dialogState.pending) event.preventDefault();
	}

	let fieldRef = $state<HTMLInputElement | null>(null);

	// A confirmation that asks for a value starts in its field.
	function focusField(event: Event) {
		if (!fieldRef) return;
		event.preventDefault();
		fieldRef.focus();
	}
</script>

<AlertDialog.Root bind:open={dialogState.open}>
	<AlertDialog.Content
		onEscapeKeydown={blockWhilePending}
		onInteractOutside={blockWhilePending}
		onOpenAutoFocus={focusField}
	>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void dialogState.submit();
			}}
			class="flex flex-col gap-4"
		>
			<AlertDialog.Header>
				<AlertDialog.Title>{dialogState.options?.title}</AlertDialog.Title>
				<AlertDialog.Description>{dialogState.options?.description}</AlertDialog.Description>
			</AlertDialog.Header>
			{#if dialogState.options?.field}
				<Field.Field>
					<Field.Label for={fieldId} class="sr-only">{dialogState.options.field.label}</Field.Label>
					<Input
						id={fieldId}
						bind:ref={fieldRef}
						bind:value={dialogState.value}
						placeholder={dialogState.options.field.placeholder}
						disabled={dialogState.pending}
						data-testid="confirm-dialog-field"
					/>
				</Field.Field>
			{/if}
			<AlertDialog.Footer>
				<AlertDialog.Cancel
					type="button"
					disabled={dialogState.pending}
					onclick={() => haptic.trigger('light')}
					data-testid="confirm-dialog-cancel"
				>
					{$t('common.cancel')}
				</AlertDialog.Cancel>
				<AlertDialog.Action
					type="submit"
					variant={dialogState.options?.tone === 'destructive' ? 'destructive' : 'default'}
					disabled={dialogState.pending}
					aria-busy={dialogState.pending}
					data-testid="confirm-dialog-confirm"
				>
					{#if dialogState.pending}
						<LoaderCircleIcon class="size-4 motion-safe:animate-spin" aria-hidden="true" />
					{/if}
					{dialogState.options?.confirmText}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</form>
	</AlertDialog.Content>
</AlertDialog.Root>
