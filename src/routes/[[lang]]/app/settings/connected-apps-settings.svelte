<script lang="ts">
	import { usePaginatedQuery, useConvexClient } from 'convex-svelte';
	import type { FunctionReturnType } from 'convex/server';
	import { T, getTranslate } from '@tolgee/svelte';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import PlugIcon from '@lucide/svelte/icons/plug';
	import { api } from '#lib/convex/_generated/api.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { DEFAULT_LANGUAGE } from '#lib/i18n/languages.js';

	type Connection = FunctionReturnType<typeof api.oauth.connections.list>['page'][number];

	const PAGE_SIZE = 20;

	const { t } = getTranslate();
	const client = useConvexClient();
	const connections = usePaginatedQuery(api.oauth.connections.list, () => ({}), {
		initialNumItems: PAGE_SIZE
	});

	let revoking = $state<Connection | null>(null);
	let shown = $state<Connection | null>(null);
	let pending = $state(false);

	const appName = (connection: Connection | null) =>
		connection?.clientName || $t('mcp.connections.unnamed_app');

	const levelKey = (connection: Connection) =>
		connection.scopes.includes('mcp:write')
			? 'mcp.connections.level_change'
			: 'mcp.connections.level_view';

	const connectedOn = (connection: Connection) =>
		connection.connectedAt === null
			? $t('mcp.connections.unknown_date')
			: new Date(connection.connectedAt).toLocaleDateString(page.data.lang ?? DEFAULT_LANGUAGE, {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				});

	function openRevoke(connection: Connection) {
		shown = connection;
		revoking = connection;
	}

	async function revoke() {
		if (!revoking) return;
		pending = true;
		try {
			await client.mutation(api.oauth.connections.revoke, { consentId: revoking.consentId });
			revoking = null;
		} catch {
			toast.error($t('mcp.connections.revoke_failed'));
		} finally {
			pending = false;
		}
	}
</script>

{#snippet cell(label: string, value: string)}
	<div class="flex items-baseline justify-between gap-3 sm:flex-col sm:gap-1">
		<dt class="text-muted-foreground sm:text-xs">{label}</dt>
		<dd class="font-medium">{value}</dd>
	</div>
{/snippet}

<Card.Root>
	<Card.Header>
		<Card.Title><T keyName="mcp.connections.title" /></Card.Title>
		<Card.Description><T keyName="mcp.connections.description" /></Card.Description>
	</Card.Header>
	<Card.Content>
		{#if connections.results.length === 0 && connections.status === 'Exhausted'}
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon"><PlugIcon /></Empty.Media>
					<Empty.Title><T keyName="mcp.connections.empty_title" /></Empty.Title>
					<Empty.Description><T keyName="mcp.connections.empty_description" /></Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			<ul class="flex flex-col gap-4">
				{#each connections.results as connection (connection.consentId)}
					<li class="rounded-md border">
						<div class="flex items-center justify-between gap-3 py-2.5 pr-2.5 pl-4">
							<span class="min-w-0 truncate text-base font-medium">{appName(connection)}</span>
							<Button
								variant="outline"
								size="sm"
								aria-label={$t('mcp.connections.revoke_label', { app: appName(connection) })}
								onclick={() => openRevoke(connection)}
							>
								<T keyName="mcp.connections.revoke" />
							</Button>
						</div>
						<dl
							class="grid gap-x-6 gap-y-2 border-t bg-muted/50 px-4 py-3 text-sm sm:grid-cols-3 sm:gap-y-1"
						>
							{@render cell($t('mcp.connections.access'), $t(levelKey(connection)))}
							{@render cell($t('mcp.connections.connected'), connectedOn(connection))}
						</dl>
					</li>
				{/each}
			</ul>
			{#if connections.status === 'CanLoadMore'}
				<Button
					variant="outline"
					class="mt-4 w-full"
					onclick={() => connections.loadMore(PAGE_SIZE)}
				>
					<T keyName="mcp.connections.load_more" />
				</Button>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>

<AlertDialog.Root
	bind:open={
		() => revoking !== null,
		(open) => {
			if (!open && !pending) revoking = null;
		}
	}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{$t('mcp.connections.revoke_title', { app: appName(shown) })}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{$t('mcp.connections.revoke_description', { app: appName(shown) })}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={pending}>
				<T keyName="mcp.connections.revoke_cancel" />
			</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" disabled={pending} onclick={revoke}>
				<T keyName="mcp.connections.revoke_confirm" />
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
