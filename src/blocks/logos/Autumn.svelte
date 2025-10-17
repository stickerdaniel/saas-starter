<script lang="ts">
	let { class: className, ...rest } = $props();
</script>

<img
	src="/autumn.png"
	alt="Autumn"
	class={className}
	style="flex: none; line-height: 1;"
	{...rest}
/>
