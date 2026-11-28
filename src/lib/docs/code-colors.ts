import githubDark from '@tanstack/highlight/themes/github-dark';
import githubLight from '@tanstack/highlight/themes/github-light';

const comment = 'var(--muted-foreground)';

/** The colour of each token class of a code block, per theme. */
export const codeColors = {
	light: { ...githubLight.tokens, comment },
	dark: { ...githubDark.tokens, comment }
};
