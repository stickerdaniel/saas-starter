<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { toast } from 'svelte-sonner';
	import { T } from '@tolgee/svelte';
	import { motion } from 'motion-sv';
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
	const isLoading = $derived(threadQuery.isLoading);
	const userId = $derived(thread?.userId);

	// Query admin users for assignment
	const adminsQuery = useQuery(api.admin.support.queries.listAdmins);

	// Query internal notes (user-level)
	const notesQuery = useQuery(api.admin.support.queries.getInternalUserNotes, () => {
		if (!userId) return 'skip';
		return {
			userId,
			paginationOpts: { numItems: 50, cursor: null }
		};
	});

	// Local state for new note
	let newNoteContent = $state('');
	let isAddingNote = $state(false);

	async function updateAssignment(adminUserId: string | undefined) {
		try {
			await client.mutation(api.admin.support.mutations.assignThread, {
				threadId,
				adminUserId: adminUserId === '' ? undefined : adminUserId
			});
			toast.success('Assignment updated');
		} catch (error) {
			toast.error('Failed to update assignment');
		}
	}

	async function updateStatus(status: 'open' | 'done') {
		try {
			await client.mutation(api.admin.support.mutations.updateThreadStatus, {
				threadId,
				status
			});
			toast.success('Status updated');
		} catch (error) {
			toast.error('Failed to update status');
		}
	}

	async function updatePriority(priority: 'low' | 'medium' | 'high' | '' | undefined) {
		try {
			await client.mutation(api.admin.support.mutations.updateThreadPriority, {
				threadId,
				priority: priority === '' ? undefined : (priority as 'low' | 'medium' | 'high' | undefined)
			});
			toast.success('Priority updated');
		} catch (error) {
			toast.error('Failed to update priority');
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
			toast.success('Note added');
		} catch (error) {
			toast.error('Failed to add note');
		} finally {
			isAddingNote = false;
		}
	}
</script>

<div class="flex h-full flex-col">
	<!-- Details Form -->
	<div class="flex-1 space-y-4 overflow-y-auto p-4">
		{#if isLoading}
			<!-- Loading skeletons -->
			<div class="space-y-4">
				{#each Array(5) as _ (Math.random())}
					<div>
						<Skeleton class="mb-2 h-4 w-20" />
						<Skeleton class="h-10 w-full" />
					</div>
				{/each}
			</div>
		{:else if thread}
			<!-- Assignee -->
			<div class="space-y-1">
				<Label><T keyName="admin.support.details.assignee" /></Label>
				<Select.Root
					type="single"
					value={thread.supportMetadata?.assignedTo ?? ''}
					onValueChange={updateAssignment}
				>
					<Select.Trigger>
						{thread.assignedAdmin?.name || 'Not assigned'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="">Unassigned</Select.Item>
						{#each adminsQuery.data || [] as admin (admin.id)}
							<Select.Item value={admin.id}>
								{admin.name || admin.email}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Status -->
			<div class="space-y-1">
				<Label><T keyName="admin.support.details.status" /></Label>
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
			</div>

			<!-- Priority -->
			<div class="space-y-1">
				<Label><T keyName="admin.support.details.priority" /></Label>
				<Select.Root
					type="single"
					value={thread.supportMetadata?.priority ?? ''}
					onValueChange={(v) => updatePriority(v as 'low' | 'medium' | 'high' | '' | undefined)}
				>
					<Select.Trigger class="capitalize">
						{thread.supportMetadata?.priority || 'None'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="">None</Select.Item>
						<Select.Item value="low"><T keyName="admin.support.priority.low" /></Select.Item>
						<Select.Item value="medium"><T keyName="admin.support.priority.medium" /></Select.Item>
						<Select.Item value="high"><T keyName="admin.support.priority.high" /></Select.Item>
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Page URL -->
			{#if thread.supportMetadata?.pageUrl}
				<div class="space-y-1">
					<Label><T keyName="admin.support.details.page_url" /></Label>
					<a
						href={thread.supportMetadata.pageUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-2 text-sm text-primary hover:underline"
					>
						<span class="truncate">{thread.supportMetadata.pageUrl}</span>
						<ExternalLinkIcon class="size-3 flex-shrink-0" />
					</a>
				</div>
			{/if}

			<!-- Internal Notes -->
			{#if userId}
				<div class="space-y-1">
					<Label><T keyName="admin.support.details.user_notes" /></Label>

					<!-- Add Note -->
					<Textarea
						placeholder="Add an internal note..."
						bind:value={newNoteContent}
						rows={3}
						class="resize-none"
					/>
					<Button size="sm" onclick={addNote} disabled={!newNoteContent.trim() || isAddingNote}>
						{isAddingNote ? 'Adding...' : 'Add Note'}
					</Button>

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
										<span class="text-sm font-medium">{note.adminName || 'Admin'}</span>
										<span class="text-xs text-muted-foreground">
											{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
										</span>
									</div>
									<p class="text-sm">{note.content}</p>
								</div>
							{/each}
						</motion.div>
					{/if}
				</div>
			{:else}
				<div class="space-y-1">
					<Label><T keyName="admin.support.details.notes" /></Label>
					<p class="text-sm text-muted-foreground">No user associated with this thread</p>
				</div>
			{/if}
		{/if}
	</div>
</div>
