<script lang="ts">
	let selectedTemplate = $state('VerificationEmail');
	let html = $state('');
	let loading = $state(false);

	const templates = ['VerificationEmail', 'PasswordResetEmail', 'AdminReplyNotificationEmail'];

	async function loadPreview() {
		loading = true;
		try {
			const res = await fetch(`/api/emails/preview?template=${selectedTemplate}`);
			const data = await res.json();
			html = data.html;
		} catch (error) {
			console.error('Failed to load preview:', error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		loadPreview();
	});
</script>

<div class="container mx-auto p-6">
	<h1 class="mb-4 text-2xl font-bold">Email Template Preview</h1>

	<div class="mb-4 flex gap-2">
		{#each templates as template}
			<button
				class="rounded px-4 py-2 transition-colors {selectedTemplate === template
					? 'bg-primary text-primary-foreground'
					: 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}"
				onclick={() => (selectedTemplate = template)}
			>
				{template}
			</button>
		{/each}
	</div>

	<div class="rounded border bg-white p-4 shadow-sm">
		{#if loading}
			<div class="flex items-center justify-center p-8">
				<p class="text-muted-foreground">Loading preview...</p>
			</div>
		{:else}
			<iframe title="Email Preview" srcdoc={html} class="h-[600px] w-full border-0" />
		{/if}
	</div>
</div>
