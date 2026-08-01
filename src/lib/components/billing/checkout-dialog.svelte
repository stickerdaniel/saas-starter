<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { getTranslate } from '@tolgee/svelte';
	import { languageContext } from '$lib/i18n/context';
	import { DEFAULT_LANGUAGE } from '$lib/i18n/languages';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import { useBillingCheckout } from './checkout-context.svelte.ts';

	const checkout = useBillingCheckout();
	const { t } = getTranslate();

	// The context holds a getter, not a snapshot: this dialog is mounted once in
	// the root layout and outlives language switches, so reading it eagerly
	// would pin currency and date formatting to whatever locale loaded first.
	const getLang = languageContext.getOr(() => DEFAULT_LANGUAGE);
	const locale = $derived(getLang());

	const preview = $derived(checkout.preview);

	function money(amount: number, currency: string): string {
		return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
	}

	function cycleStart(startsAt: number): string {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(startsAt));
	}
</script>

<AlertDialog.Root bind:open={() => checkout.open, (open) => checkout.setOpen(open)}>
	<AlertDialog.Content>
		{#if preview}
			<AlertDialog.Header>
				<AlertDialog.Title>{$t('billing.confirmation.title')}</AlertDialog.Title>
				<AlertDialog.Description>
					{$t('billing.confirmation.description', { planName: preview.product.name })}
				</AlertDialog.Description>
			</AlertDialog.Header>

			<dl class="flex flex-col gap-2 text-sm">
				<div class="flex items-center justify-between gap-4">
					<dt class="text-muted-foreground">{$t('billing.confirmation.product')}</dt>
					<dd class="font-medium">{preview.product.name}</dd>
				</div>

				{#each checkout.options as option (option.featureId)}
					<div class="flex items-center justify-between gap-4">
						<dt class="text-muted-foreground">
							{$t('billing.confirmation.quantity', { featureId: option.featureId })}
						</dt>
						<dd>{option.quantity}</dd>
					</div>
				{/each}

				<!-- Keyed by object identity: two lines can carry the same wording, and a
				     duplicate key is a runtime crash. -->
				{#each preview.lines as line (line)}
					<div class="flex items-start justify-between gap-4">
						<dt class="text-muted-foreground">{line.description}</dt>
						<dd>{money(line.amount, preview.currency)}</dd>
					</div>
				{/each}

				<div class="flex items-center justify-between gap-4 border-t pt-2 font-medium">
					<dt>{$t('billing.confirmation.due_today')}</dt>
					<dd data-testid="billing-checkout-total">{money(preview.total, preview.currency)}</dd>
				</div>

				{#if preview.next_cycle}
					<div class="flex items-center justify-between gap-4">
						<dt class="text-muted-foreground">
							{$t('billing.confirmation.due_next_cycle', {
								date: cycleStart(preview.next_cycle.starts_at)
							})}
						</dt>
						<dd>{money(preview.next_cycle.total, preview.currency)}</dd>
					</div>
				{/if}
			</dl>

			{#if preview.has_prorations}
				<p class="text-sm text-muted-foreground">
					{$t('billing.confirmation.proration_details')}
				</p>
			{/if}

			<AlertDialog.Footer>
				<AlertDialog.Cancel
					type="button"
					disabled={checkout.isAttaching}
					aria-disabled={checkout.isAttaching}
					class="aria-disabled:pointer-events-none aria-disabled:opacity-50"
					onclick={() => {
						haptic.trigger('light');
						checkout.cancel();
					}}
					data-testid="billing-checkout-cancel"
				>
					{$t('common.cancel')}
				</AlertDialog.Cancel>
				<AlertDialog.Action
					type="button"
					disabled={checkout.isAttaching || checkout.isUpdating}
					onclick={() => {
						haptic.trigger('light');
						checkout.confirm();
					}}
					data-testid="billing-checkout-confirm"
				>
					{#if checkout.isAttaching}
						<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />
					{/if}
					{$t('common.confirm')}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		{/if}
	</AlertDialog.Content>
</AlertDialog.Root>
