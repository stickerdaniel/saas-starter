<script>
	import { page } from '$app/state';
	/**
	 * @typedef {Object} Props
	 * @property {import('svelte').Snippet} [children]
	 */

	/** @type {Props} */
	let { children } = $props();
</script>

<div class="flex min-h-screen w-full">
	<aside class="bg-surface-100-900 border-surface-200-800 w-48 border-r p-2">
		<nav class="flex h-full max-h-screen flex-col gap-2">
			<a
				href="/product"
				class="text-surface-950-50 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium {page
					.url.pathname === '/product'
					? 'bg-surface-200-800'
					: ''}"
			>
				<span class="h-4 w-4">💬</span>
				Chat
			</a>

			<a
				href="https://docs.convex.dev"
				class="text-surface-700-300 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium"
			>
				<span class="h-4 w-4">📚</span>
				Docs
			</a>

			<a
				href="/"
				class="text-surface-700-300 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium"
			>
				<span class="h-4 w-4">🏠</span>
				Home
			</a>
		</nav>
	</aside>

	{@render children?.()}
</div>
