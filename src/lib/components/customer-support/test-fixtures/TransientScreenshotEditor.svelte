<script module lang="ts">
	let mounts = 0;
</script>

<script lang="ts">
	const attempt = ++mounts;
	$effect(() => {
		if (attempt === 1) throw new Error('Screenshot editor failed on its first start');
	});
</script>

<p data-testid="screenshot-editor-ready">Editor ready</p>
