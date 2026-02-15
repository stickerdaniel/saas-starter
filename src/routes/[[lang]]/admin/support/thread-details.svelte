<script lang="ts">
	import { fade } from 'svelte/transition';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import {
		INTERNAL_NOTES_PAGE_SIZE,
		INTERNAL_NOTE_TEXTAREA_ROWS
	} from '$lib/convex/admin/support/constants';
	import * as Select from '$lib/components/ui/select';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { toast } from 'svelte-sonner';
	import { T, getTranslate } from '@tolgee/svelte';
	import { motion } from 'motion-sv';

	const { t } = getTranslate();
	import { formatDistanceToNow } from 'date-fns';

	let {
		threadId
	}: {
		threadId: string;
	} = $props();

	const client = useConvexClient();

	// Query thread details
	const threadQuery = useQuery(api.admin.support.queries.getThreadForAdmin, () => ({
		threadId
	}));

	// Derive thread and user data
	const thread = $derived(threadQuery.data);
	const userId = $derived(thread?.userId);

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
			toast.success($t('admin.users.toast.assignment_updated'));
		} catch (error) {
			toast.error(
				$t('admin.users.toast.assignment_failed', {
					message: error instanceof Error ? error.message : 'Unknown error'
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
			toast.success($t('admin.users.toast.status_updated'));
		} catch (error) {
			toast.error(
				$t('admin.users.toast.status_failed', {
					message: error instanceof Error ? error.message : 'Unknown error'
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
			toast.error(
				$t('admin.users.toast.priority_failed', {
					message: error instanceof Error ? error.message : 'Unknown error'
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
			toast.error(
				$t('admin.users.toast.note_failed', {
					message: error instanceof Error ? error.message : 'Unknown error'
				})
			);
		} finally {
			isAddingNote = false;
		}
	}
</script>

<div class="flex h-full flex-col">
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
							<Select.Trigger class="capitalize">
								{thread.supportMetadata?.status || 'open'}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="open"><T keyName="admin.support.status.open" /></Select.Item>
								<Select.Item value="done"><T keyName="admin.support.status.done" /></Select.Item>
							</Select.Content>
						</Select.Root>
					</Field.Field>

					<!-- Priority -->
					<Field.Field>
						<Field.Label><T keyName="admin.support.details.priority" /></Field.Label>
						<Select.Root
							type="single"
							value={thread.supportMetadata?.priority ?? ''}
							onValueChange={(v) => updatePriority(v as 'low' | 'medium' | 'high' | '' | undefined)}
						>
							<Select.Trigger class="capitalize">
								{thread.supportMetadata?.priority || $t('admin.support.priority.none')}
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
							<a
								href="mailto:{thread.supportMetadata
									.notificationEmail}?subject=Re: Your support request&body=Hi,%0A%0AThank you for reaching out!%0A%0A"
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center gap-2 text-sm text-primary hover:underline"
							>
								<span class="truncate">{thread.supportMetadata.notificationEmail}</span>
								<ExternalLinkIcon class="size-3 flex-shrink-0" />
							</a>
						</Field.Field>
					{/if}

					<!-- Page URL -->
					{#if thread.supportMetadata?.pageUrl}
						<Field.Field>
							<Field.Label><T keyName="admin.support.details.page_url" /></Field.Label>
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<a
								href={thread.supportMetadata.pageUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center gap-2 text-sm text-primary hover:underline"
							>
								<span class="truncate">{thread.supportMetadata.pageUrl}</span>
								<ExternalLinkIcon class="size-3 flex-shrink-0" />
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
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
								class="resize-none"
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
								<motion.div
									initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
									animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
									transition={{ duration: 0.4, ease: 'easeOut' }}
									class="mt-4 space-y-2"
								>
									{#each notesQuery.data.page as note (note._id)}
										<div class="rounded-md bg-muted p-3">
											<div class="mb-1 flex items-center justify-between">
												<span class="text-sm font-medium"
													>{note.adminName || $t('admin.support.fallback.admin')}</span
												>
												<span class="text-xs text-muted-foreground">
													{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
												</span>
											</div>
											<p class="text-sm">{note.content}</p>
										</div>
									{/each}
								</motion.div>
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
		{/if}
	</div>
</div>
