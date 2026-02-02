<script lang="ts">
	let { class: className, ...rest } = $props();
</script>

<img
	src="/autumn.webp"
	alt="Autumn"
	class={className}
	style="flex: none; line-height: 1;"
	loading="lazy"
	decoding="async"
	width="40"
	height="40"
	{...rest}
/>
