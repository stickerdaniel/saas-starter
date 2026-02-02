# Animation Rules

Always follow these rules when implementing animations.

## Accessibility: Reduced Motion

Always respect user preferences for reduced motion:

```css
/* CSS approach - wrap animations */
@media (prefers-reduced-motion: no-preference) {
	.animated-element {
		transition: transform 0.3s ease-out;
	}
}

/* Or disable for those who prefer reduced motion */
@media (prefers-reduced-motion: reduce) {
	.animated-element {
		animation: none;
		transition: none;
	}
}
```

```svelte
<!-- Svelte approach - check preference -->
<script>
	import { browser } from '$app/environment';

	const prefersReducedMotion = browser
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;
</script>

{#if !prefersReducedMotion}
	<div transition:fade>Animated content</div>
{:else}
	<div>Static content</div>
{/if}
```

**Key principles:**

- Use `prefers-reduced-motion: reduce` media query
- Provide instant alternatives (no animation, or very subtle)
- Never disable essential functionality, only decorative motion
- Test with "Reduce motion" enabled in OS accessibility settings

## When to Animate

**Do animate:**

- Enter/exit transitions for spatial consistency
- State changes that benefit from visual continuity
- Responses to user actions (feedback)
- Rarely-used interactions where delight adds value

**Don't animate:**

- Keyboard-initiated actions
- Hover effects on frequently-used elements
- Anything users interact with 100+ times daily
- When speed matters more than smoothness

## Easing decision flowchart

```text
Is the element entering or exiting the viewport?
├── Yes → ease-out
└── No
    ├── Is it moving or morphing on screen?
    │   └── Yes → ease-in-out
    └── Is it a hover change?
        ├── Yes → ease or cubic-bezier (0.19, 1, 0.22, 1) or cubic-bezier(0.785, 0.135, 0.15, 0.86) (don't forget to support focus-visible!)
        └── Is it constant motion?
            ├── Yes → linear
            └── Default → ease-out
```

## Icon Transitions (Toggle States)

For morphing icons (e.g., toggle buttons):

```svelte
<!-- Icon 1 -->
<Icon
	class="transition-all duration-200 ease-in-out {active
		? 'blur-0 scale-100 opacity-100'
		: 'scale-0 opacity-0 blur-sm'}"
/>

<!-- Icon 2 -->
<Icon
	class="transition-all duration-200 ease-in-out {active
		? 'scale-0 opacity-0 blur-sm'
		: 'blur-0 scale-100 opacity-100'}"
/>
```

**Standard:** 200ms, `ease-in-out`, opacity + scale + `blur-sm` → `blur-0`

## View Transitions API

The View Transitions API provides smooth transitions between page states (navigation) and component states.

### Page Transitions (Navigation)

Add to `src/routes/+layout.svelte`:

```svelte
<script lang="ts">
	import { onNavigate } from '$app/navigation';

	onNavigate((navigation) => {
		if (!document.startViewTransition) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>
```

### State Transitions (In-Place)

For component state changes:

```svelte
<script lang="ts">
	type State = 'idle' | 'loading' | 'success' | 'error';
	let state = $state<State>('idle');

	function transition(action: () => void) {
		if (!document.startViewTransition) return action();
		document.startViewTransition(action);
	}

	function updateState() {
		transition(() => (state = 'loading'));
	}
</script>

<button data-state={state} onclick={updateState}>
	{#if state === 'idle'}
		Start
	{:else if state === 'loading'}
		<LoadingIcon />
	{/if}
</button>

<style>
	/* Give element unique view-transition-name */
	button {
		view-transition-name: my-button;
	}

	/* Optional: Override aspect ratio preservation for UI elements */
	:global(html)::view-transition-old(my-button),
	:global(html)::view-transition-new(my-button) {
		width: 100%;
		height: 100%;
	}
</style>
```

### Customizing Transitions

Default behavior is crossfade. Customize with CSS:

```css
/* Custom page transition */
@media (prefers-reduced-motion: no-preference) {
	:root::view-transition-old(root) {
		animation:
			90ms cubic-bezier(0.4, 0, 1, 1) both fade-out,
			300ms cubic-bezier(0.4, 0, 0.2, 1) both slide-to-left;
	}

	:root::view-transition-new(root) {
		animation:
			210ms cubic-bezier(0, 0, 0.2, 1) 90ms both fade-in,
			300ms cubic-bezier(0.4, 0, 0.2, 1) both slide-from-right;
	}
}

@keyframes fade-in {
	from {
		opacity: 0;
	}
}

@keyframes fade-out {
	to {
		opacity: 0;
	}
}

@keyframes slide-from-right {
	from {
		transform: translateX(30px);
	}
}

@keyframes slide-to-left {
	to {
		transform: translateX(-30px);
	}
}
```

### Isolating Elements

Elements with unique `view-transition-name` are animated separately:

```css
/* Header stays in place, doesn't slide */
header {
	view-transition-name: header;
}

/* Active indicator slides smoothly */
nav [aria-current='page']::before {
	view-transition-name: active-indicator;
}
```

### Aspect Ratio Handling

**Default:** Browser preserves aspect ratio (good for images/media)  
**UI elements:** Often need width/height override

```css
/* Images - use default (preserves aspect) */
img {
	view-transition-name: product-image;
}

/* Buttons/cards - override aspect ratio */
:global(html)::view-transition-old(product-card),
:global(html)::view-transition-new(product-card) {
	width: 100%;
	height: 100%;
}
```
