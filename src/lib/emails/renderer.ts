import { Renderer } from '@better-svelte-email/server';
import layoutStyles from '../../routes/layout.css?raw';
import preflightCss from 'tailwindcss/preflight.css?raw';
import { sanitizeEmailCss } from './email-css';

const emailLayoutStyles = sanitizeEmailCss(layoutStyles);

// Tailwind uses the last definition for duplicate custom variants. Keep the
// email-safe media definition after the app CSS so its class-based `dark`
// variant cannot override email rendering.
const EMAIL_DARK_VARIANT_OVERRIDE = `@custom-variant dark {
	@media (prefers-color-scheme: dark) {
		@slot;
	}
}`;

export const renderer = new Renderer({
	customCSS: `${preflightCss}\n${emailLayoutStyles}\n${EMAIL_DARK_VARIANT_OVERRIDE}`,
	tailwindConfig: {
		// Media is the only dark-mode strategy an email can use: a mail client never
		// toggles a `.dark` ancestor, it only reports the system colour scheme. The
		// compiler then emits each `dark:` rule nested inside its own class selector,
		// and that shape has to survive into the generated HTML. Outlook does not
		// parse CSS nesting, so it keeps its own inversion untouched; a flat
		// `@media (prefers-color-scheme: dark)` block instead collapses the card into
		// the same grey as the boxes and the button. Apple Mail renders both shapes
		// identically, and only enters dark mode at all because of the colour-scheme
		// meta tags in components/layout/EmailHead.svelte.
		darkMode: 'media',
		theme: {
			extend: {}
		}
	}
});
