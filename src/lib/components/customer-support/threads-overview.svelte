<script lang="ts">
	import { untrack } from 'svelte';
	import { usePaginatedQuery, useQuery } from 'convex-svelte';
	import { getTranslate } from '@tolgee/svelte';
	import { api } from '$lib/convex/_generated/api';
	import { Button } from '$lib/components/ui/button';
	import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/avatar';
	import BotIcon from '@lucide/svelte/icons/bot';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import UsersRoundIcon from '@lucide/svelte/icons/users-round';
	import { supportThreadContext } from './support-thread-context.svelte.ts';
	import AvatarHeading from './avatar-heading.svelte';
	import { FadeOnLoad } from '$lib/utils/fade-on-load.svelte.ts';
	import memberFour from '$blocks/team/avatars/member-four.webp';
	import memberTwo from '$blocks/team/avatars/member-two.webp';
	import memberFive from '$blocks/team/avatars/member-five.webp';
	import { motion } from 'motion-sv';
	import { SvelteSet } from 'svelte/reactivity';
	import { isAnonymousUser } from '$lib/convex/utils/anonymousUser';
	import { isSupportAiEnabled } from '$lib/config/support';
	import { page } from '$app/state';
	import { DEFAULT_LANGUAGE } from '$lib/i18n/languages';
	import SupportUnreadIndicator from './support-unread-indicator.svelte';
	import { hasConversationActivity } from './thread-activity';

	const { t } = getTranslate();

	const ctx = supportThreadContext.get();
	const anonymousUserId = $derived.by(() => {
		const userId = ctx.userId;
		return isAnonymousUser(userId) ? (userId ?? undefined) : undefined;
	});

	// Reactive paginated query keeps every conversation reachable as the inbox grows.
	// Skipped until the owner is known: an authenticated visitor carries the same
	// (empty) argument before and after the session resolves, so a subscription
	// opened too early answers "no conversations" for an owner nobody identified
	// yet, and the greeting claims an empty inbox to someone who has threads.
	const threadsQuery = usePaginatedQuery(
		api.support.threads.listThreads,
		() => (ctx.userId ? { anonymousUserId } : 'skip'),
		{ initialNumItems: 20 }
	);

	// Filter out threads with no messages (e.g., eagerly created but never used threads)
	const threads = $derived(threadsQuery.results.filter(hasConversationActivity));
	const isLoading = $derived(!ctx.userId ? true : threadsQuery.isLoading);
	// Query error: without this branch the greeting/empty state would swallow it
	// (self-heals when the live Convex subscription recovers). Only while nothing
	// is on screen: a failed page keeps the results already delivered, and taking
	// the whole list away would cost the visitor conversations they were reading.
	const loadError = $derived(threadsQuery.error);
	// An explicit control rather than infinite scroll: the widget's unread signal
	// covers every conversation the owner has, so an older one carrying an unread
	// reply has to stay reachable without depending on scroll position.
	const canLoadMore = $derived(threadsQuery.status === 'CanLoadMore');
	const isLoadingMore = $derived(threadsQuery.status === 'LoadingMore');

	// Swapping the control for the message and back takes the focused element
	// away with it each time, and the browser drops focus to the document. Both
	// sides of the swap pick it up again, but only when it was actually lost, so
	// a failure or a recovery that arrives on its own never pulls focus away
	// from whatever the visitor was doing. A recovery that ends the pagination
	// altogether has nothing left to hand focus to.
	let messageTookFocus = false;

	function claimLostFocus(node: HTMLElement) {
		messageTookFocus = document.activeElement === document.body;
		if (messageTookFocus) node.focus();
	}

	function returnLostFocus(node: HTMLElement) {
		if (!messageTookFocus) return;
		messageTookFocus = false;
		if (document.activeElement === document.body) node.focus();
	}

	// Query admin avatars for the welcome screen
	const adminAvatarsQuery = useQuery(api.support.threads.getAdminAvatars, {});
	const adminUsers = $derived(adminAvatarsQuery.data ?? []);

	const isAdminDataLoaded = $derived(!adminAvatarsQuery.isLoading);

	// Placeholder avatars with grayscale filter when not enough admins
	const placeholderAvatars = [memberFour, memberTwo, memberFive];
	// With the agent switched off nobody is behind the bot face, so it drops
	// out of the lineup that promises who will answer.
	const showBotIcon = $derived(isSupportAiEnabled() && adminUsers.length < 3);

	/**
	 * The greeting shows a stack of three faces. The bot takes one of them when
	 * it answers, so the admins fill two slots then and three otherwise. Any slot
	 * a real admin cannot fill falls back to a grayscale placeholder, which keeps
	 * the stack the same size on a deployment with a small team.
	 */
	const displayAvatars = $derived.by(() => {
		const slotCount = showBotIcon ? 2 : 3;
		// Shuffle admins for randomness
		const shuffledAdmins = [...adminUsers].sort(() => Math.random() - 0.5);
		const teamMemberAlt = untrack(() => $t('support.avatar.team_member'));

		const avatars = shuffledAdmins.slice(0, slotCount).map((admin, i) => ({
			src: admin.image ?? placeholderAvatars[i],
			alt: admin.name ?? teamMemberAlt,
			isPlaceholder: false
		}));

		for (let i = avatars.length; i < slotCount; i++) {
			avatars.push({
				src: placeholderAvatars[i],
				alt: teamMemberAlt,
				isPlaceholder: true
			});
		}

		return avatars;
	});

	// Track which avatar image URLs have actually finished loading in the DOM.
	// Populated by each <Avatar>'s onLoadingStatusChange below, so the gate
	// reflects the *displayed* image. bits-ui runs its own internal load and
	// keeps the <img> at display:none until it settles; gating on a separate
	// preload let the stack animate in while the rendered image was still hidden
	// (showing a transparent circle). Keyed by URL, so it survives the shuffle.
	let loadedAvatarUrls = new SvelteSet<string>();

	// Get the image URLs we need to load (only after admin data is ready)
	// This ensures we wait for the actual admin images, not placeholders shown before data loads
	const imageUrlsToLoad = $derived.by(() => {
		if (!isAdminDataLoaded) return [];
		return displayAvatars.map((a) => a.src).filter((url): url is string => !!url);
	});

	// All images are ready when every displayed avatar has settled (loaded or errored)
	const allImagesLoaded = $derived(
		imageUrlsToLoad.length > 0 && imageUrlsToLoad.every((url) => loadedAvatarUrls.has(url))
	);

	// Mark an avatar URL as settled once bits-ui finishes its load. Errors still
	// unblock the entrance so one broken image can't stall the whole greeting.
	function markAvatarSettled(url: string | undefined, status: 'loading' | 'loaded' | 'error') {
		if (url && status !== 'loading') loadedAvatarUrls.add(url);
	}

	// Fallback: force the entrance animation if an image takes too long to load.
	// Uses a plain setTimeout (not runed's useDebounce): calling a useDebounce
	// function inside an $effect makes the effect track the debouncer's internal
	// reactive state, so it re-runs, cancels itself in cleanup, reschedules, and
	// loops until `effect_update_depth_exceeded` (the debounced callback never
	// fires, so allImagesLoaded never settles). See #402 regression.
	const ANIMATION_TIMEOUT = 3000;

	$effect(() => {
		if (allImagesLoaded || !isAdminDataLoaded) return;

		const timer = setTimeout(() => {
			imageUrlsToLoad.forEach((url) => loadedAvatarUrls.add(url));
		}, ANIMATION_TIMEOUT);

		return () => clearTimeout(timer);
	});

	// Fade animation state - triggers only on first successful load
	const threadsFade = new FadeOnLoad();

	// Track first load to trigger fade animation (one-time side effect)
	$effect(() => {
		if (!isLoading && !threadsFade.hasLoadedOnce) {
			threadsFade.markLoaded();
		}
	});

	/**
	 * Format a timestamp as relative time (e.g., "a few seconds ago", "3 minutes ago")
	 *
	 * The customer-facing widget intentionally uses bespoke Tolgee phrasing for
	 * relative time, distinct from the admin path (thread-list/thread-details),
	 * which renders date-fns formatDistanceToNow. Keep this hand-rolled wording.
	 */
	function formatRelativeTime(timestamp?: number): string {
		if (!timestamp) return '';

		const now = Date.now();
		const diff = now - timestamp;
		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (seconds < 10) return $t('support.time.just_now');
		if (seconds < 60) return $t('support.time.few_seconds_ago');
		if (minutes === 1) return $t('support.time.one_minute_ago');
		if (minutes < 60) return $t('support.time.minutes_ago', { minutes });
		if (hours === 1) return $t('support.time.one_hour_ago');
		if (hours < 24) return $t('support.time.hours_ago', { hours });
		if (days === 1) return $t('support.time.yesterday');
		if (days < 7) return $t('support.time.days_ago', { days });

		return new Date(timestamp).toLocaleDateString(page.data.lang ?? DEFAULT_LANGUAGE);
	}
</script>

<div class="flex h-full flex-col" inert={ctx.currentView !== 'overview' ? true : undefined}>
	<!-- Thread List -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if loadError && threads.length === 0}
			<div
				class="flex h-full items-center justify-center p-8 text-center text-balance text-destructive"
				data-testid="support-threads-error"
			>
				{$t('support.thread.load_error')}
			</div>
		{:else if !isLoading && threads.length === 0}
			<!-- Empty state with greeting (only shown after query completes) -->
			<div class="flex h-full flex-col justify-start">
				<div class="m-10 flex flex-col items-start">
					<!-- Avatar stack: Conditional bot icon + admin avatars -->
					<div class="mb-6 flex -space-x-3">
						{#if showBotIcon}
							<!-- Avatar 1: Bot icon (only shown when <3 admins) -->
							<motion.div
								initial={{ opacity: 0, y: 20 }}
								animate={allImagesLoaded ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
								transition={{
									opacity: { duration: 0.2, delay: 0.1 },
									y: { type: 'spring', stiffness: 260, damping: 12, mass: 0.8, delay: 0.1 }
								}}
							>
								<Avatar class="size-12 bg-primary outline outline-4 outline-secondary">
									<AvatarFallback class="bg-primary text-primary-foreground">
										<BotIcon class="size-8" />
									</AvatarFallback>
								</Avatar>
							</motion.div>
						{/if}

						<!-- Avatars: Admin avatars or grayscale placeholders -->
						{#each displayAvatars as avatar, i (i)}
							{@const delay = showBotIcon ? 0.15 + i * 0.05 : 0.1 + i * 0.05}
							<motion.div
								initial={{ opacity: 0, y: 20 }}
								animate={allImagesLoaded ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
								transition={{
									opacity: { duration: 0.2, delay },
									y: { type: 'spring', stiffness: 260, damping: 12, mass: 0.8, delay }
								}}
							>
								<Avatar
									class="size-12 outline outline-4 outline-secondary"
									onLoadingStatusChange={(status) => markAvatarSettled(avatar.src, status)}
								>
									<AvatarImage
										src={avatar.src}
										alt={avatar.alt}
										class={avatar.isPlaceholder ? 'object-cover grayscale' : 'object-cover'}
									/>
									<!-- Never transparent while loading: neutral circle for placeholders,
									     the admin's initial otherwise (also the timeout-path safety net). -->
									<AvatarFallback
										class={avatar.isPlaceholder
											? 'bg-muted text-muted-foreground'
											: 'bg-primary text-primary-foreground'}
									>
										{#if avatar.isPlaceholder}
											<UsersRoundIcon class="size-6" />
										{:else}
											<span class="text-lg font-medium">{avatar.alt.charAt(0).toUpperCase()}</span>
										{/if}
									</AvatarFallback>
								</Avatar>
							</motion.div>
						{/each}
					</div>

					<!-- Greeting (gated on allImagesLoaded so the whole entrance plays as one
					     sequence once the avatars are ready, instead of text-then-avatars) -->
					<motion.h2
						initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
						animate={allImagesLoaded
							? { opacity: 1, y: 0, filter: 'blur(0px)' }
							: { opacity: 0, y: 6, filter: 'blur(6px)' }}
						transition={{ duration: 0.4, delay: 0.25, ease: 'easeOut' }}
						class="mb-4 text-5xl font-semibold text-muted-foreground"
					>
						{$t('support.greeting.hi')} 👋
					</motion.h2>

					<!-- Main heading -->
					<motion.h3
						initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
						animate={allImagesLoaded
							? { opacity: 1, y: 0, filter: 'blur(0px)' }
							: { opacity: 0, y: 6, filter: 'blur(6px)' }}
						transition={{ duration: 0.4, delay: 0.5, ease: 'easeOut' }}
						class="text-3xl font-bold"
					>
						{$t('support.greeting.how_can_we_help')}
					</motion.h3>
				</div>
			</div>
		{:else}
			<!-- Thread list with fade-in animation on first load -->
			<!-- data-tolgee-restricted: thread previews may contain ZWNJ/ZWJ (tolgee/tolgee-js#3475) -->
			<div data-tolgee-restricted class={threadsFade.animationClass}>
				{#each threads as thread (thread._id)}
					{@const isSelected = thread._id === ctx.threadId}
					{@const showAdminAvatar = thread.isHandedOff && thread.assignedAdmin}
					<button
						class="flex w-full items-center gap-3 border-b border-border/30 p-4 px-5 text-left transition-colors duration-150 {isSelected
							? 'bg-muted-foreground/[0.04]'
							: 'hover:bg-muted-foreground/[0.06]'}"
						onclick={() =>
							ctx.selectThread(
								thread._id,
								thread.lastAgentName,
								thread.isHandedOff,
								thread.assignedAdmin,
								thread.notificationEmail
							)}
					>
						<AvatarHeading
							icon={thread.isHandedOff
								? thread.assignedAdmin?.image || thread.assignedAdmin?.name
									? undefined
									: UsersRoundIcon
								: BotIcon}
							image={showAdminAvatar ? thread.assignedAdmin?.image : undefined}
							title={thread.lastMessage || thread.summary || $t('support.thread.new_conversation')}
							subtitle={`${thread.lastMessageRole === 'user' ? $t('support.message.role_you') : showAdminAvatar ? thread.assignedAdmin?.name || $t('support.message.role_support') : thread.lastAgentName || $t('support.message.role_kai')}\u00A0\u00A0·\u00A0\u00A0${formatRelativeTime(thread.lastMessageAt)}`}
							bold={false}
							fallbackText={thread.isHandedOff && thread.assignedAdmin?.name
								? thread.assignedAdmin.name
								: undefined}
						/>

						{#if thread.hasUnreadAdminReply}
							<SupportUnreadIndicator />
							<span class="sr-only">{$t('support.thread.unread_reply')}</span>
						{/if}

						<!-- Chevron -->
						<ChevronRightIcon class="size-5 shrink-0 text-muted-foreground" />
					</button>
				{/each}

				{#if canLoadMore || isLoadingMore}
					<div class="p-4">
						<!-- A failed page leaves the query reporting that it is still loading
						     and the hook exposes no reset, so nothing here can start another
						     attempt: loadMore only acts while the status says more can load.
						     Keeping the control visible would hand the visitor a button that
						     does nothing, so the failure is reported instead; the control
						     returns by itself once the subscription recovers.

						     The region is always present so that the message is announced
						     when it appears. Filling a live region that mounts in the same
						     update is unreliable, and the failure replaces the control the
						     visitor just pressed, so it has to speak for itself. -->
						<div role="status" aria-live="polite">
							{#if loadError}
								<p
									{@attach claimLostFocus}
									tabindex="-1"
									class="text-center text-sm text-balance text-destructive outline-none"
								>
									{$t('support.thread.load_error')}
								</p>
							{/if}
						</div>
						{#if !loadError}
							<Button
								variant="ghost"
								class="w-full"
								disabled={isLoadingMore}
								onclick={() => threadsQuery.loadMore(20)}
								{@attach returnLostFocus}
							>
								{#if isLoadingMore}
									<Loader2Icon
										class="size-4 text-muted-foreground motion-safe:animate-spin"
										aria-hidden="true"
									/>
								{/if}
								{$t('support.button.show_older_conversations')}
							</Button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- New Message Button -->
	<div class="shrink-0 border-t border-border/50 bg-secondary p-4">
		<Button
			class="w-full rounded-full"
			onclick={() => ctx.startNewThread()}
			size="lg"
			disabled={ctx.isRateLimited}
		>
			<PlusIcon />
			{$t('support.button.start_new_conversation')}
		</Button>
	</div>
</div>
