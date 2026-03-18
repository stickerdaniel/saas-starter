<script lang="ts">
	import { cn } from '$lib/utils.js';

	interface SpotlightProps {
		class?: string;
		fill?: string;
	}

	let { class: className = '', fill = 'white' }: SpotlightProps = $props();
</script>

<svg
	class={cn(
		'pointer-events-none absolute z-[1] h-[300%] w-[250%] animate-spotlight opacity-0 motion-reduce:animate-none motion-reduce:opacity-100',
		className
	)}
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 3787 2842"
	fill="none"
	aria-hidden="true"
>
	<g filter="url(#spotlight-filter)" transform="translate(3787,0) scale(-1,1)">
		<ellipse
			cx="1924.71"
			cy="273.501"
			rx="1924.71"
			ry="273.501"
			transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
			{fill}
			fill-opacity="0.35"
		></ellipse>
	</g>
	<defs>
		<filter
			id="spotlight-filter"
			x="-500"
			y="-500"
			width="4787"
			height="3842"
			filterUnits="userSpaceOnUse"
			color-interpolation-filters="sRGB"
		>
			<feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood>
			<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend>
			<feGaussianBlur stdDeviation="151" result="effect1_foregroundBlur"></feGaussianBlur>
		</filter>
	</defs>
</svg>
