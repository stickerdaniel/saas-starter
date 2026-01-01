<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { Button } from '$lib/components/ui/button';
	import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/avatar';
	import { Bot, ChevronRight, Send } from '@lucide/svelte';
	import { supportThreadContext } from './support-thread-context.svelte';
	import AvatarHeading from './avatar-heading.svelte';
	import { FadeOnLoad } from '$lib/utils/fade-on-load.svelte.js';
	import memberFour from '$blocks/team/avatars/member-four.webp';
	import memberTwo from '$blocks/team/avatars/member-two.webp';
	import memberFive from '$blocks/team/avatars/member-five.webp';
	import { motion } from 'motion-sv';

	const ctx = supportThreadContext.get();

	// Reactive query for threads - auto-updates when new threads are created
	const threadsQuery = $derived(
		ctx.userId
			? useQuery(api.support.threads.listThreads, {
					userId: ctx.userId,
					paginationOpts: { numItems: 20, cursor: null }
				})
			: undefined
	);

	const threads = $derived(threadsQuery?.data?.page ?? []);
	const isLoading = $derived(threadsQuery?.isLoading ?? !ctx.userId);

	// Query admin avatars for the welcome screen
	const adminAvatarsQuery = useQuery(api.support.threads.getAdminAvatars, {});
	const adminUsers = $derived(adminAvatarsQuery.data ?? []);
	const isAdminDataLoaded = $derived(!adminAvatarsQuery.isLoading);

	// Track image elements for load detection
	let avatarImageRefs: (HTMLImageElement | null)[] = $state([null, null, null]);

	// Track image loading state
	let loadedImagesCount = $state(0);
	const expectedImageCount = $derived(adminUsers.length >= 3 ? 3 : 2);
	const allImagesLoaded = $derived(loadedImagesCount >= expectedImageCount && isAdminDataLoaded);

	// Reset loaded count only when expected count changes (admin list changed)
	let prevExpectedCount = $state(0);
	$effect(() => {
		if (expectedImageCount !== prevExpectedCount) {
			loadedImagesCount = 0;
			// Re-initialize with proper length to avoid undefined refs
			avatarImageRefs = Array(Math.max(expectedImageCount, 3)).fill(null);
			prevExpectedCount = expectedImageCount;
		}
	});

	// Helper to wait for image to be fully decoded
	async function waitForImageDecode(img: HTMLImageElement | null): Promise<boolean> {
		if (!img) return false;

		console.log('[Avatar Loading] Checking image:', img.src);

		// Check if already complete
		if (img.complete && img.naturalWidth > 0) {
			console.log('[Avatar Loading] Image already complete, decoding...');
			try {
				await img.decode();
				console.log('[Avatar Loading] Image decoded successfully');
				return true;
			} catch {
				console.warn('[Avatar Loading] Decode failed, but image is complete');
				return true;
			}
		}

		// Wait for load event
		console.log('[Avatar Loading] Waiting for image to load...');
		return new Promise((resolve) => {
			const handleLoad = async () => {
				console.log('[Avatar Loading] Image loaded, decoding...');
				try {
					await img.decode();
					console.log('[Avatar Loading] Image decoded successfully');
				} catch {
					console.warn('[Avatar Loading] Decode failed after load');
				}
				resolve(true);
			};

			const handleError = () => {
				console.error('[Avatar Loading] Image failed to load');
				resolve(false);
			};

			img.addEventListener('load', handleLoad, { once: true });
			img.addEventListener('error', handleError, { once: true });
		});
	}

	async function handleImageLoad(index: number) {
		const img = avatarImageRefs[index];
		if (!img) return;

		// Wait for image to be fully decoded before counting
		const loaded = await waitForImageDecode(img);
		if (loaded) {
			loadedImagesCount += 1;
		}
	}

	// Check for already-loaded (cached) images when component mounts or images change
	$effect(() => {
		if (!isAdminDataLoaded) return;

		// Check each image and wait for decode
		avatarImageRefs.forEach(async (img, i) => {
			if (!img) return;

			// Only process if not already counted
			if (img.complete && img.naturalWidth > 0) {
				const loaded = await waitForImageDecode(img);
				if (loaded && i < expectedImageCount) {
					// Trigger load handler which increments count
					handleImageLoad(i);
				}
			}
		});
	});

	// Fallback: Force animations if images take too long to load
	const ANIMATION_TIMEOUT = 3000; // ms - Increased for slow connections
	$effect(() => {
		if (allImagesLoaded) return;

		const timer = setTimeout(() => {
			if (!allImagesLoaded && isAdminDataLoaded) {
				console.warn('[Avatar Loading] Timeout reached, forcing animations');
				loadedImagesCount = expectedImageCount;
			}
		}, ANIMATION_TIMEOUT);

		return () => clearTimeout(timer);
	});

	// Placeholder avatars with grayscale filter when not enough admins
	const placeholderAvatars = [memberFour, memberTwo, memberFive];

	/**
	 * Select avatars to display based on admin count:
	 * - If 3+ admins: Show 3 admin avatars (no bot icon)
	 * - If 2 admins: Show 2 admin avatars (bot icon shown separately)
	 * - If 1 admin: Show 1 admin + 1 grayscale placeholder (bot icon shown separately)
	 * - If 0 admins: Show 2 grayscale placeholders (bot icon shown separately)
	 */
	const displayAvatars = $derived.by(() => {
		// Shuffle admins for randomness
		const shuffledAdmins = [...adminUsers].sort(() => Math.random() - 0.5);

		if (shuffledAdmins.length >= 3) {
			// Case 1: 3+ admins - show 3 random admin avatars (no bot icon)
			return shuffledAdmins.slice(0, 3).map((admin, i) => ({
				src: admin.image ?? placeholderAvatars[i],
				alt: admin.name ?? 'Team member',
				isPlaceholder: false
			}));
		} else if (shuffledAdmins.length >= 2) {
			// Case 2: 2 admins - show 2 admin avatars (bot icon shown separately)
			return shuffledAdmins.slice(0, 2).map((admin, i) => ({
				src: admin.image ?? placeholderAvatars[i],
				alt: admin.name ?? 'Team member',
				isPlaceholder: false
			}));
		} else {
			// Case 3 & 4: <2 admins - show admins + grayscale placeholders (bot icon shown separately)
			const result = [];

			// Add all admin avatars (use different placeholders for fallback)
			shuffledAdmins.forEach((admin, i) => {
				result.push({
					src: admin.image ?? placeholderAvatars[i],
					alt: admin.name ?? 'Team member',
					isPlaceholder: false
				});
			});

			// Fill remaining slots with grayscale placeholders
			const remaining = 2 - shuffledAdmins.length;
			for (let i = 0; i < remaining; i++) {
				result.push({
					src: placeholderAvatars[shuffledAdmins.length + i],
					alt: 'Team member',
					isPlaceholder: true
				});
			}

			return result;
		}
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
	 */
	function formatRelativeTime(timestamp?: number): string {
		if (!timestamp) return '';

		const now = Date.now();
		const diff = now - timestamp;
		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (seconds < 10) return 'just now';
		if (seconds < 60) return 'a few seconds ago';
		if (minutes === 1) return '1 minute ago';
		if (minutes < 60) return `${minutes} minutes ago`;
		if (hours === 1) return '1 hour ago';
		if (hours < 24) return `${hours} hours ago`;
		if (days === 1) return 'yesterday';
		if (days < 7) return `${days} days ago`;

		return new Date(timestamp).toLocaleDateString();
	}
</script>

<div class="flex h-full flex-col">
	<!-- Thread List -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if !isLoading && threads.length === 0}
			<!-- Empty state with greeting (only shown after query completes) -->
			<div class="flex h-full flex-col justify-start">
				<div class="m-10 flex flex-col items-start">
					<!-- Avatar stack: Conditional bot icon + admin avatars -->
					<div class="mb-6 flex -space-x-3">
						{#if adminUsers.length < 3}
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
										<Bot class="size-8" />
									</AvatarFallback>
								</Avatar>
							</motion.div>
						{/if}

						<!-- Avatars: Admin avatars or grayscale placeholders -->
						{#each displayAvatars as avatar, i (i)}
							<motion.div
								initial={{ opacity: 0, y: 20 }}
								animate={allImagesLoaded ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
								transition={{
									opacity: {
										duration: 0.2,
										delay: adminUsers.length < 3 ? 0.15 + i * 0.05 : 0.1 + i * 0.05
									},
									y: {
										type: 'spring',
										stiffness: 260,
										damping: 12,
										mass: 0.8,
										delay: adminUsers.length < 3 ? 0.15 + i * 0.05 : 0.1 + i * 0.05
									}
								}}
							>
								<Avatar class="size-12 outline outline-4 outline-secondary">
									<AvatarImage
										bind:ref={avatarImageRefs[i]}
										src={avatar.src}
										alt={avatar.alt}
										class={avatar.isPlaceholder ? 'object-cover grayscale' : 'object-cover'}
										onload={() => handleImageLoad(i)}
									/>
								</Avatar>
							</motion.div>
						{/each}
					</div>

					<!-- Greeting -->
					<motion.h2
						initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
						animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
						transition={{ duration: 0.4, delay: 0.25, ease: 'easeOut' }}
						class="mb-4 text-5xl font-semibold text-muted-foreground"
					>
						Hi 👋
					</motion.h2>

					<!-- Main heading -->
					<motion.h3
						initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
						animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
						transition={{ duration: 0.4, delay: 0.5, ease: 'easeOut' }}
						class="text-3xl font-bold"
					>
						How can we help you today?
					</motion.h3>
				</div>
			</div>
		{:else}
			<!-- Thread list with fade-in animation on first load -->
			<div class={threadsFade.animationClass}>
				{#each threads as thread (thread._id)}
					{@const isSelected = thread._id === ctx.threadId}
					<button
						class="flex w-full items-center gap-3 border-b border-border/30 p-4 px-5 text-left transition-none {isSelected
							? 'bg-muted-foreground/[0.02]'
							: 'hover:bg-muted-foreground/[0.03]'}"
						onclick={() => ctx.selectThread(thread._id, thread.lastAgentName)}
					>
						<AvatarHeading
							icon={Bot}
							title={thread.lastMessage || thread.summary || 'New conversation'}
							subtitle={`${thread.lastMessageRole === 'user' ? 'You' : thread.lastAgentName || 'Kai'}\u00A0\u00A0·\u00A0\u00A0${formatRelativeTime(thread.lastMessageAt)}`}
							bold={false}
						/>

						<!-- Chevron -->
						<ChevronRight class="size-5 shrink-0 text-muted-foreground" />
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- New Message Button -->
	<div class="shrink-0 border-t border-border/50 bg-secondary p-4">
		<Button
			class=" w-full rounded-full active:scale-99"
			onclick={() => ctx.startNewThread()}
			size="lg"
		>
			<Send />
			Start a new conversation
		</Button>
	</div>
</div>
