import { Renderer } from '@better-svelte-email/server';
import layoutStyles from '../../routes/layout.css?raw';
import preflightCss from 'tailwindcss/preflight.css?raw';
import { sanitizeEmailCss } from './email-css';

const emailLayoutStyles = sanitizeEmailCss(layoutStyles);

export const renderer = new Renderer({
	customCSS: `${preflightCss}\n${emailLayoutStyles}`,
	tailwindConfig: {
		darkMode: undefined, // Disable dark mode for emails
		theme: {
			extend: {}
		}
	}
});
