<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import UserAvatar from '#lib/components/user-avatar.svelte';
	import { TruncatedText } from '#lib/components/ui/truncated-text/index.js';

	let { name, email, image }: { name?: string; email?: string; image?: string | null } = $props();

	const { t } = getTranslate();
</script>

<div class="flex min-w-0 items-center gap-2">
	<!-- Decorative: the name beside it carries the row's identity -->
	<UserAvatar {name} {email} {image} fallbackSize="xs" />
	<div class="min-w-0 flex-1 font-medium">
		<TruncatedText text={name || $t('admin.users.unnamed')} />
	</div>
</div>
