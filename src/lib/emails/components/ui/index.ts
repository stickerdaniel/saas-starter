// Email-safe shadcn-svelte components
// These components use the same tv() + cn() architecture as shadcn-svelte

// Simple components - direct exports
export { default as Separator } from './separator/separator.svelte';
export { default as Badge, badgeVariants, type BadgeVariant } from './badge/badge.svelte';
export {
	default as Button,
	buttonVariants,
	type ButtonProps,
	type ButtonVariant,
	type ButtonSize
} from './button/button.svelte';
export { default as Progress } from './progress/progress.svelte';

// Compound components - namespace exports (same as shadcn-svelte)
export * as Alert from './alert/index.js';
export * as Avatar from './avatar/index.js';
export * as Card from './card/index.js';
export * as Item from './item/index.js';
