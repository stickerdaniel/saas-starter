import Renderer from 'better-svelte-email/render';
import layoutStyles from '../../routes/layout.css?raw';
import preflightCss from 'tailwindcss/preflight.css?raw';

export const renderer = new Renderer({
	customCSS: `${preflightCss}\n${layoutStyles}`,
	tailwindConfig: {
		darkMode: undefined, // Disable dark mode for emails
		theme: {
			extend: {}
		}
	}
});
