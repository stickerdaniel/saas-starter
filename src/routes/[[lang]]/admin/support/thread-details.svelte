<script lang="ts">
	import { fade } from 'svelte/transition';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '#lib/convex/_generated/api.js';
	import {
		INTERNAL_NOTES_PAGE_SIZE,
		INTERNAL_NOTE_TEXTAREA_ROWS
	} from '#lib/convex/admin/support/constants.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import UserRoundCheckIcon from '@lucide/svelte/icons/user-round-check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
	import { toast } from 'svelte-sonner';
	import { T, getTranslate } from '@tolgee/svelte';

	import { format, formatDistanceToNow } from 'date-fns';
	import { page } from '$app/state';
	import { getDateFnsLocale } from '#lib/utils/i18n.js';
	import { buildMailto } from '#lib/utils/mailto.js';
	import { normalizeSupportPageRoute } from '#lib/shared/support-page-route.js';
	import { activeUploadsContext } from '#lib/hooks/active-uploads.svelte.ts';
	import { canImpersonateUser, impersonateUser } from '../impersonate-user';

	const { t } = getTranslate();

	const STATUS_LABEL_KEYS = {
		open: 'admin.support.status.open',
		done: 'admin.support.status.done'
	} as const;

	const PRIORITY_LABEL_KEYS = {
		low: 'admin.support.priority.low',
		medium: 'admin.support.priority.medium',
		high: 'admin.support.priority.high'
	} as const;

	const dateFnsLocale = $derived(getDateFnsLocale(page.data.lang));

	function formatReadTimestamp(timestamp: number): string {
		return format(new Date(timestamp), 'PPp', { locale: dateFnsLocale });
	}

	let {
		threadId,
		canImpersonate = false,
		viewerId
	}: {
		threadId: string;
		/** Whether the signed-in admin's role may impersonate users. */
		canImpersonate?: boolean;
		/** The signed-in admin, who has no one to impersonate in their own ticket. */
		viewerId?: string;
	} = $props();

	const client = useConvexClient();
	const activeUploads = activeUploadsContext.getOr(null);

	// Query thread details
	const threadQuery = useQuery(api.admin.support.queries.getThreadForAdmin, () => ({
		threadId
	}));

	// Derive thread and user data
	const thread = $derived(threadQuery.data);
	const userId = $derived(thread?.userId);
	// Rows stored before routes were normalized can still hold any client-supplied
	// string, so the link only ever carries a same-origin pathname.
	const pageRoute = $derived(normalizeSupportPageRoute(thread?.supportMetadata?.pageUrl));

	// The id comes from the account lookup, not the ticket's owner field, so a
	// ticket whose owner no longer resolves to an account keeps the plain link.
	const targetUserId = $derived(thread?.user?.id);
	const canImpersonateTarget = $derived(
		canImpersonate && canImpersonateUser(targetUserId, viewerId)
	);
	let impersonating = $state(false);

	async function openPageAsCustomer(route: string) {
		if (!targetUserId || impersonating) return;
		haptic.trigger('light');
		impersonating = true;
		const outcome = await impersonateUser(targetUserId, activeUploads, route);
		if (!outcome.started) {
			toast.error($t('admin.users.toast.impersonate_failed', { message: $t(outcome.messageKey) }));
			impersonating = false;
		}
	}

	// Query admin users for assignment
	const adminsQuery = useQuery(api.admin.support.queries.listAdmins);

	// Query internal notes (user-level)
	const notesQuery = useQuery(api.admin.support.queries.listInternalUserNotes, () => {
		if (!userId) return 'skip';
		return {
			userId,
			paginationOpts: { numItems: INTERNAL_NOTES_PAGE_SIZE, cursor: null }
		};
	});

	// Local state for new note
	let newNoteContent = $state('');
	let isAddingNote = $state(false);

	async function updateAssignment(adminUserId: string | undefined) {
		try {
			await client.mutation(api.admin.support.mutations.updateThreadAssignment, {
				threadId,
				adminUserId: adminUserId === '' ? undefined : adminUserId
			});
			haptic.trigger('success');
			toast.success($t('admin.users.toast.assignment_updated'));
		} catch (error) {
			console.error('[admin-support] Action failed:', error);
			toast.error(
				$t('admin.users.toast.assignment_failed', {
					message: $t('common.error')
				})
			);
		}
	}

	async function updateStatus(status: 'open' | 'done') {
		try {
			await client.mutation(api.admin.support.mutations.updateThreadStatus, {
				threadId,
				status
			});
			haptic.trigger('success');
			toast.success($t('admin.users.toast.status_updated'));
		} catch (error) {
			console.error('[admin-support] Action failed:', error);
			toast.error(
				$t('admin.users.toast.status_failed', {
					message: $t('common.error')
				})
			);
		}
	}

	async function updatePriority(priority: 'low' | 'medium' | 'high' | '' | undefined) {
		try {
			await client.mutation(api.admin.support.mutations.updateThreadPriority, {
				threadId,
				priority: priority === '' ? undefined : (priority as 'low' | 'medium' | 'high' | undefined)
			});
			toast.success($t('admin.users.toast.priority_updated'));
		} catch (error) {
			console.error('[admin-support] Action failed:', error);
			toast.error(
				$t('admin.users.toast.priority_failed', {
					message: $t('common.error')
				})
			);
		}
	}

	async function addNote() {
		if (!newNoteContent.trim() || !userId) return;

		isAddingNote = true;
		try {
			await client.mutation(api.admin.support.mutations.addInternalUserNote, {
				userId,
				content: newNoteContent.trim()
			});
			newNoteContent = '';
			toast.success($t('admin.users.toast.note_added'));
		} catch (error) {
			console.error('[admin-support] Action failed:', error);
			toast.error(
				$t('admin.users.toast.note_failed', {
					message: $t('common.error')
				})
			);
		} finally {
			isAddingNote = false;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<!-- Details Form -->
	<div class="flex-1 overflow-y-auto p-4">
		{#if thread}
			<div in:fade={{ duration: 150 }}>
				<Field.Group>
					<!-- Assignee -->
					<Field.Field>
						<Field.Label><T keyName="admin.support.details.assignee" /></Field.Label>
						<Select.Root
							type="single"
							value={thread.supportMetadata?.assignedTo ?? ''}
							onValueChange={updateAssignment}
						>
							<Select.Trigger>
								{thread.assignedAdmin?.name || $t('admin.support.assignee.not_assigned')}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value=""><T keyName="admin.support.assignee.unassigned" /></Select.Item
								>
								{#each adminsQuery.data || [] as admin (admin.id)}
									<Select.Item value={admin.id}>
										{admin.name || admin.email}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</Field.Field>

					<!-- Status -->
					<Field.Field>
						<Field.Label><T keyName="admin.support.details.status" /></Field.Label>
						<Select.Root
							type="single"
							value={thread.supportMetadata?.status || 'open'}
							onValueChange={(v) => updateStatus(v as 'open' | 'done')}
						>
							<Select.Trigger>
								{$t(STATUS_LABEL_KEYS[thread.supportMetadata?.status || 'open'])}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="open"><T keyName="admin.support.status.open" /></Select.Item>
								<Select.Item value="done"><T keyName="admin.support.status.done" /></Select.Item>
							</Select.Content>
						</Select.Root>
					</Field.Field>

					{#if thread.supportMetadata.lastAdminReplyAt}
						<Field.Field>
							<Field.Label><T keyName="admin.support.details.reply_status" /></Field.Label>
							<p
								class="text-sm {thread.supportMetadata.userReadAt &&
								thread.supportMetadata.hasUnreadAdminReply !== true
									? 'text-muted-foreground'
									: 'text-warning'}"
								data-testid="support-user-read-status"
							>
								{#if thread.supportMetadata.userReadAt && thread.supportMetadata.hasUnreadAdminReply !== true}
									{$t('admin.support.details.read_at', {
										timestamp: formatReadTimestamp(thread.supportMetadata.userReadAt)
									})}
								{:else}
									<T keyName="admin.support.details.unread" />
								{/if}
							</p>
						</Field.Field>
					{/if}

					<!-- Priority -->
					<Field.Field>
						<Field.Label><T keyName="admin.support.details.priority" /></Field.Label>
						<Select.Root
							type="single"
							value={thread.supportMetadata?.priority ?? ''}
							onValueChange={(v) => updatePriority(v as 'low' | 'medium' | 'high' | '' | undefined)}
						>
							<Select.Trigger>
								{$t(
									thread.supportMetadata?.priority
										? PRIORITY_LABEL_KEYS[thread.supportMetadata.priority]
										: 'admin.support.priority.none'
								)}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value=""><T keyName="admin.support.priority.none" /></Select.Item>
								<Select.Item value="low"><T keyName="admin.support.priority.low" /></Select.Item>
								<Select.Item value="medium"
									><T keyName="admin.support.priority.medium" /></Select.Item
								>
								<Select.Item value="high"><T keyName="admin.support.priority.high" /></Select.Item>
							</Select.Content>
						</Select.Root>
					</Field.Field>

					<!-- Notification Email -->
					{#if thread.supportMetadata?.notificationEmail}
						<Field.Field>
							<Field.Label><T keyName="admin.support.email.label" /></Field.Label>
							<!-- A mailto: address is not an app route, so there is nothing to resolve -->
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<a
								href={buildMailto({
									email: thread.supportMetadata.notificationEmail,
									subject: $t('admin.support.email.reply_subject'),
									body: $t('admin.support.email.reply_body')
								})}
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center gap-2 text-sm text-primary hover:underline active:translate-y-px"
							>
								<span class="truncate">{thread.supportMetadata.notificationEmail}</span>
								<ExternalLinkIcon class="size-3 shrink-0" />
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</Field.Field>
					{/if}

					<!-- Page URL -->
					{#if pageRoute}
						<Field.Field>
							<Field.Label><T keyName="admin.support.details.page_url" /></Field.Label>
							{#if canImpersonateTarget}
								<Tooltip.Root>
									<Tooltip.Trigger>
										{#snippet child({ props })}
											<button
												{...props}
												type="button"
												onclick={() => openPageAsCustomer(pageRoute)}
												disabled={impersonating}
												class="flex min-w-0 items-center gap-2 text-left text-sm text-primary hover:underline active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
											>
												<span class="truncate">{pageRoute}</span>
												<span class="sr-only">{$t('admin.support.chat.open_as_customer')}</span>
												{#if impersonating}
													<LoaderCircleIcon class="size-3 shrink-0 motion-safe:animate-spin" />
												{:else}
													<UserRoundCheckIcon class="size-3 shrink-0" />
												{/if}
											</button>
										{/snippet}
									</Tooltip.Trigger>
									<Tooltip.Content>{$t('admin.support.chat.open_as_customer')}</Tooltip.Content>
								</Tooltip.Root>
							{:else}
								<!-- eslint-disable svelte/no-navigation-without-resolve -->
								<a
									href={pageRoute}
									target="_blank"
									rel="noopener noreferrer"
									class="flex items-center gap-2 text-sm text-primary hover:underline active:translate-y-px"
								>
									<span class="truncate">{pageRoute}</span>
									<ExternalLinkIcon class="size-3 shrink-0" />
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{/if}
						</Field.Field>
					{/if}

					<!-- Internal Notes -->
					{#if userId}
						<Field.Field>
							<Field.Label><T keyName="admin.support.details.user_notes" /></Field.Label>

							<!-- Add Note -->
							<Textarea
								placeholder={$t('admin.support.note.placeholder')}
								bind:value={newNoteContent}
								rows={INTERNAL_NOTE_TEXTAREA_ROWS}
								resize="none"
								class="max-h-48"
							/>
							<div class="flex justify-end">
								<Button
									size="sm"
									onclick={addNote}
									disabled={!newNoteContent.trim() || isAddingNote}
								>
									{isAddingNote ? $t('admin.support.note.adding') : $t('admin.support.note.add')}
								</Button>
							</div>

							<!-- Notes List -->
							{#if notesQuery.data?.page && notesQuery.data.page.length > 0}
								<!-- data-tolgee-restricted: notes may contain ZWNJ/ZWJ (tolgee/tolgee-js#3475) -->
								<div data-tolgee-restricted class="mt-4 animate-enter-blur-up space-y-2">
									{#each notesQuery.data.page as note (note._id)}
										<div class="rounded-md bg-muted p-3">
											<div class="mb-1 flex items-center justify-between">
												<span class="text-sm font-medium"
													>{note.adminName || $t('admin.support.fallback.admin')}</span
												>
												<span class="text-xs text-muted-foreground">
													{formatDistanceToNow(new Date(note.createdAt), {
														locale: dateFnsLocale,
														addSuffix: true
													})}
												</span>
											</div>
											<p class="text-sm">{note.content}</p>
										</div>
									{/each}
								</div>
							{/if}
						</Field.Field>
					{:else}
						<Field.Field>
							<Field.Label><T keyName="admin.support.details.notes" /></Field.Label>
							<p class="text-sm text-muted-foreground">
								<T keyName="admin.support.fallback.no_user" />
							</p>
						</Field.Field>
					{/if}
				</Field.Group>
			</div>
		{:else if threadQuery.error}
			<div
				class="flex h-full items-center justify-center text-center text-balance text-destructive"
				data-testid="thread-details-error"
			>
				<T keyName="common.load_error" />
			</div>
		{/if}
	</div>
</div>
