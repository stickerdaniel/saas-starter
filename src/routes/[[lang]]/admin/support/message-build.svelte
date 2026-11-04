<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal';
	import { getTranslate } from '@tolgee/svelte';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { getCommitUrl } from '#lib/config/site.js';
	import { UseClipboard } from '#lib/hooks/use-clipboard.svelte.ts';

	interface Props {
		/** The build the customer's tab reported, normally a full commit SHA. */
		build: string;
	}

	const { build }: Props = $props();
	const { t } = getTranslate();
	const clipboard = new UseClipboard({ delay: 1500 });
	// Only a full commit SHA names a commit to link to. Any other build name,
	// such as `dev` from a local build, shows as it is.
	const isCommit = $derived(/^[0-9a-f]{40}$/.test(build));
	const copyLabel = $derived(
		clipboard.status === 'success'
			? $t('admin.support.chat.build_link_copied')
			: clipboard.status === 'failure'
				? $t('aria.copy_failed')
				: $t('admin.support.chat.copy_build_link')
	);
</script>

{#if isCommit}
	<!-- Stays open on click, so the copy result shows where the pointer is. -->
	<Tooltip.Root disableCloseOnTriggerClick>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					onclick={() => clipboard.copy(getCommitUrl(build))}
					data-testid="admin-support-message-build"
					class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
				>
					{#if clipboard.copied}
						<CheckIcon class="size-3 shrink-0" />
					{:else}
						<GitCommitHorizontalIcon class="size-3 shrink-0" />
					{/if}
					<span class="font-mono">{build.slice(0, 7)}</span>
					<span class="sr-only">{$t('admin.support.chat.copy_build_link')}</span>
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>
			<span class="flex flex-col gap-0.5">
				{copyLabel}
				<span class="font-mono">{build}</span>
			</span>
		</Tooltip.Content>
	</Tooltip.Root>
	<span class="sr-only" aria-live="polite">{clipboard.status ? copyLabel : ''}</span>
{:else}
	<span
		class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
		data-testid="admin-support-message-build"
	>
		<GitCommitHorizontalIcon class="size-3 shrink-0" />
		<span class="sr-only">{$t('admin.support.chat.build')}</span>
		<span class="truncate font-mono">{build}</span>
	</span>
{/if}
