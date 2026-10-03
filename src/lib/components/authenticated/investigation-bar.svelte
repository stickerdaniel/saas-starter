<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import { Button } from '$lib/components/ui/button';
	import { impersonationContext } from '$lib/hooks/use-impersonation.svelte.ts';
	import { readInvestigationReturn } from '$lib/admin/investigation-return';
	import { getAdminSidebarConfig } from './configs/admin-sidebar-config';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UserRoundSearchIcon from '@lucide/svelte/icons/user-round-search';

	const { t } = getTranslate();
	const impersonation = impersonationContext.get();

	// Stays up after the live session stops saying "impersonating", so a failed
	// exit is still on screen with a way out.
	const visible = $derived(impersonation.isImpersonating || impersonation.exit !== 'idle');
	const stopping = $derived(impersonation.exit === 'stopping');

	/** The admin section the return lands in, named as the admin sidebar names it. */
	function sectionKeyFor(target: string | null): string | null {
		const segment = adminSegment(target);
		if (!segment) return null;
		return (
			getAdminSidebarConfig({ pathname: '' }).navItems.find(
				(item) => adminSegment(item.url ?? null) === segment
			)?.translationKey ?? null
		);
	}

	/** `users` for `/en/admin/users?search=a`; `undefined` for the admin root. */
	function adminSegment(path: string | null): string | undefined {
		return path?.match(/^\/[a-z]{2}\/admin\/([^/?]+)/)?.[1];
	}

	// Read when the bar appears: the cookie only changes on a start or a
	// completed exit, and both leave the document.
	const sectionKey = $derived(visible ? sectionKeyFor(readInvestigationReturn()) : null);
	const section = $derived($t(sectionKey ?? 'app.investigation_bar.admin_fallback'));
</script>

{#if visible}
	<!-- Opaque base under the tint: the bar stays on top while marketing pages
	     scroll beneath it. -->
	<div class="border-b border-warning/20 bg-background">
		<div
			role="region"
			aria-label={$t('app.investigation_bar.label')}
			data-testid="investigation-bar"
			data-exit={impersonation.exit}
			class="flex items-center gap-x-3 gap-y-2 bg-warning/10 px-4 py-2 text-sm text-foreground max-sm:flex-wrap"
		>
			{#if impersonation.exit === 'recovery' || impersonation.exit === 'returnPending'}
				<TriangleAlertIcon class="size-4 shrink-0 text-warning" />
				<span class="min-w-0 flex-1" aria-live="polite" data-testid="investigation-bar-message">
					{#if impersonation.exit === 'recovery'}
						<T keyName="app.investigation_bar.recovery" />
					{:else}
						<T keyName="app.investigation_bar.return_pending" />
					{/if}
				</span>
				<span class="flex flex-wrap gap-2 max-sm:w-full">
					{#if impersonation.exit === 'returnPending'}
						<Button
							variant="outline"
							size="sm"
							aria-disabled={impersonation.pending}
							aria-busy={impersonation.pending}
							onclick={() => impersonation.retryReturn($t)}
							data-testid="investigation-bar-return"
						>
							{#if impersonation.pending}
								<LoaderCircleIcon data-icon="inline-start" class="motion-safe:animate-spin" />
							{:else}
								<ArrowLeftIcon data-icon="inline-start" />
							{/if}
							<T keyName="app.investigation_bar.return_to" params={{ section }} />
						</Button>
					{/if}
					<Button
						variant={impersonation.exit === 'recovery' ? 'outline' : 'ghost'}
						size="sm"
						aria-disabled={impersonation.pending}
						onclick={() => impersonation.signInAgain()}
						data-testid="investigation-bar-sign-in"
					>
						<LogInIcon data-icon="inline-start" />
						<T keyName="app.investigation_bar.sign_in_again" />
					</Button>
				</span>
			{:else}
				<UserRoundSearchIcon class="size-4 shrink-0 text-warning" />
				<span
					class="line-clamp-2 min-w-0 flex-1 wrap-anywhere"
					data-testid="investigation-bar-viewing"
				>
					{#if impersonation.viewedUser}
						<T
							keyName="app.investigation_bar.viewing_as"
							params={{
								name: impersonation.viewedUser.name,
								email: impersonation.viewedUser.email
							}}
						/>
					{/if}
				</span>
				<Button
					variant="outline"
					size="sm"
					class="shrink-0"
					aria-disabled={impersonation.pending}
					aria-busy={stopping}
					onclick={() => impersonation.stop($t)}
					data-testid="investigation-bar-back"
				>
					{#if stopping}
						<LoaderCircleIcon data-icon="inline-start" class="motion-safe:animate-spin" />
					{:else}
						<ArrowLeftIcon data-icon="inline-start" />
					{/if}
					<T keyName="app.investigation_bar.back_to" params={{ section }} />
				</Button>
			{/if}
		</div>
	</div>
{/if}
