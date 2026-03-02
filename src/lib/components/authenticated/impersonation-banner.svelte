<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { authClient } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { localizedHref } from '$lib/utils/i18n';
	import { toast } from 'svelte-sonner';
	import { T, getTranslate } from '@tolgee/svelte';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import XIcon from '@lucide/svelte/icons/x';

	const { t } = getTranslate();

	interface Props {
		adminName?: string | null;
		adminEmail?: string | null;
	}

	let { adminName = null, adminEmail = null }: Props = $props();
	let stopping = $state(false);

	const adminLabel = $derived(adminName || adminEmail || '');

	async function stopImpersonating() {
		stopping = true;
		try {
			const result = await authClient.admin.stopImpersonating();
			if (result.error) {
				toast.error($t('app.user_menu.impersonation_stop_failed'));
				stopping = false;
				return;
			}
			toast.success($t('app.user_menu.impersonation_stopped'));
			await goto(resolve(localizedHref('/admin/users')));
		} catch {
			toast.error($t('app.user_menu.impersonation_stop_failed'));
			stopping = false;
		}
	}
</script>

<div
	class="bg-warning/10 text-warning border-warning/20 flex items-center justify-between border-b px-4 py-2 text-sm font-medium"
	role="alert"
	data-testid="impersonation-banner"
>
	<div class="flex items-center gap-2">
		<EyeIcon class="size-4 shrink-0" />
		<span>
			<T keyName="impersonation.banner_text" />
			{#if adminLabel}
				<span class="font-semibold">({adminLabel})</span>
			{/if}
		</span>
	</div>
	<Button
		variant="outline"
		size="sm"
		onclick={stopImpersonating}
		disabled={stopping}
		class="border-warning/30 text-warning hover:bg-warning/20 h-7 gap-1.5 text-xs"
		data-testid="impersonation-stop-button"
	>
		<XIcon class="size-3.5" />
		<span class="sr-only sm:not-sr-only">
			<T keyName="impersonation.stop_button" />
		</span>
	</Button>
</div>
