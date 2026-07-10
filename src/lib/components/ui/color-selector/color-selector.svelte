<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { WithElementRef } from '$lib/utils.js';

	export const colorMap = {
		default: 'var(--foreground)',
		red: 'var(--color-red-500)',
		green: 'var(--color-green-500)',
		blue: 'var(--color-blue-500)',
		yellow: 'var(--color-yellow-500)',
		purple: 'var(--color-purple-500)',
		pink: 'var(--color-pink-500)',
		indigo: 'var(--color-indigo-500)',
		orange: 'var(--color-orange-500)',
		teal: 'var(--color-teal-500)',
		cyan: 'var(--color-cyan-500)',
		lime: 'var(--color-lime-500)',
		emerald: 'var(--color-emerald-500)',
		violet: 'var(--color-violet-500)',
		fuchsia: 'var(--color-fuchsia-500)',
		rose: 'var(--color-rose-500)',
		sky: 'var(--color-sky-500)',
		amber: 'var(--color-amber-500)'
	} as const;

	export const colorSelectorDotVariants = tv({
		base: 'motion-safe:transition-transform motion-safe:duration-200 motion-safe:active:scale-90 cursor-pointer rounded-full border border-transparent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
		variants: {
			size: {
				sm: 'size-4',
				default: 'size-5',
				lg: 'size-6'
			},
			selected: {
				true: 'ring-2 ring-offset-2',
				false: ''
			}
		},
		defaultVariants: {
			size: 'default',
			selected: false
		}
	});

	export type ColorSelectorPresetColor = keyof typeof colorMap;
	export type ColorSelectorCssColor =
		| `#${string}`
		| `rgb(${string})`
		| `rgba(${string})`
		| `hsl(${string})`
		| `hsla(${string})`
		| `hwb(${string})`
		| `lab(${string})`
		| `lch(${string})`
		| `oklab(${string})`
		| `oklch(${string})`
		| `color(${string})`
		| `var(--${string})`
		| 'transparent'
		| 'currentColor';
	export type ColorSelectorColor = ColorSelectorPresetColor | ColorSelectorCssColor;
	export type ColorSelectorSize = VariantProps<typeof colorSelectorDotVariants>['size'];
	export type ColorSelectorProps = WithElementRef<
		HTMLAttributes<HTMLDivElement> & {
			colors?: readonly ColorSelectorColor[];
			size?: ColorSelectorSize;
			defaultValue?: ColorSelectorColor;
			value?: ColorSelectorColor;
			name?: string;
			onColorSelect?: (color: ColorSelectorColor) => void;
			/**
			 * Resolve an accessible label for a swatch. Consumers pass a localized
			 * lookup (e.g. Tolgee) so screen readers announce color names, not raw
			 * CSS values. Falls back to the color value when omitted.
			 */
			getColorLabel?: (color: ColorSelectorColor) => string;
			class?: string;
		},
		HTMLDivElement
	>;
</script>

<script lang="ts">
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		colors = [],
		size = 'default',
		defaultValue,
		value = $bindable(),
		name,
		onColorSelect,
		getColorLabel,
		class: className,
		...props
	}: ColorSelectorProps = $props();

	function isPresetColor(color: ColorSelectorColor): color is ColorSelectorPresetColor {
		return color in colorMap;
	}

	function getColorValue(color: ColorSelectorColor) {
		return isPresetColor(color) ? colorMap[color] : color;
	}

	function isColorAvailable(color: ColorSelectorColor | undefined): color is ColorSelectorColor {
		return color !== undefined && (colors.length === 0 || colors.includes(color));
	}

	let selectedColor = $derived.by(() => {
		if (isColorAvailable(value)) {
			return value;
		}

		if (isColorAvailable(defaultValue)) {
			return defaultValue;
		}

		return colors[0];
	});

	// Roving tabindex: only one swatch is a tab stop. The selected swatch owns it,
	// falling back to the first swatch when nothing is selected.
	let tabbableIndex = $derived.by(() => {
		const index = colors.indexOf(selectedColor as ColorSelectorColor);
		return index >= 0 ? index : 0;
	});

	let buttonRefs: HTMLButtonElement[] = $state([]);

	function selectColor(color: ColorSelectorColor) {
		value = color;
		onColorSelect?.(color);
	}

	// Radiogroup convention: moving focus with the arrow keys also selects,
	// like native radio buttons.
	function focusSwatch(index: number) {
		const target = buttonRefs[index];
		const color = colors[index];
		if (!target || color === undefined) return;
		selectColor(color);
		target.focus();
	}

	function handleKeydown(event: KeyboardEvent, index: number) {
		let targetIndex: number;
		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				targetIndex = (index + 1) % colors.length;
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				targetIndex = (index - 1 + colors.length) % colors.length;
				break;
			case 'Home':
				targetIndex = 0;
				break;
			case 'End':
				targetIndex = colors.length - 1;
				break;
			default:
				return;
		}
		// Stop the page from scrolling and keep the key from reaching ancestor
		// keyboard handlers (e.g. the screenshot editor's global shortcuts).
		event.preventDefault();
		event.stopPropagation();
		focusSwatch(targetIndex);
	}
</script>

<div
	bind:this={ref}
	data-slot="spell-color-selector"
	role="radiogroup"
	class={cn('flex gap-2', className)}
	{...props}
>
	{#if name}
		<input type="hidden" {name} value={selectedColor ?? ''} />
	{/if}

	{#each colors as color, index (color)}
		{@const colorValue = getColorValue(color)}
		{@const isSelected = selectedColor === color}

		<button
			bind:this={buttonRefs[index]}
			type="button"
			role="radio"
			tabindex={index === tabbableIndex ? 0 : -1}
			class={cn(colorSelectorDotVariants({ size, selected: isSelected }))}
			style:background-color={colorValue}
			style:box-shadow={isSelected
				? `inset 0 0 0 2px var(--background), 0 0 0 2px ${colorValue}`
				: undefined}
			aria-label={getColorLabel?.(color) ?? color}
			aria-checked={isSelected}
			onclick={() => selectColor(color)}
			onkeydown={(event) => handleKeydown(event, index)}
		></button>
	{/each}
</div>
