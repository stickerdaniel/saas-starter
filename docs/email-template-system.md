# Email Template System Architecture

## Overview

This document outlines the architecture for creating email templates that automatically inherit styles from shadcn-svelte's design system. The system uses `better-svelte-email` for rendering and extracts theme colors from `app.css` at build time.

## Core Principles

1. **Single Source of Truth**: All design tokens come from `app.css`
2. **No Manual Style Updates**: When `app.css` changes, emails automatically update on rebuild
3. **Email Client Compatibility**: OKLch colors and CSS variables resolved to inline styles
4. **Reusable**: Components published to shadcn-svelte registry for community use

## Architecture

```
app.css (source of truth)
    ↓ (Vite ?raw import at build time)
createShadcnRenderer() (parses CSS, configures Renderer)
    ↓
Email components use bg-primary, text-foreground, etc.
    ↓
Renderer inlines actual color values into HTML
```

## Implementation Plan

### Add helper to better-svelte-email

Create a PR adding `createShadcnRenderer()` helper to the library.

**Implementation:**

```typescript
// better-svelte-email/src/lib/shadcn/index.ts
import appCss from '../../../../../src/app.css?raw';
import Renderer from '../render/index.js';

function parseCssVariables(css: string): Record<string, string> {
	const variables: Record<string, string> = {};
	const rootMatch = css.match(/:root\s*\{([^}]+)\}/s);
	if (!rootMatch) return variables;

	const varRegex = /--([\w-]+):\s*([^;]+);/g;
	let match;
	while ((match = varRegex.exec(rootMatch[1])) !== null) {
		variables[match[1]] = match[2].trim();
	}
	return variables;
}

export function createShadcnRenderer() {
	const themeColors = parseCssVariables(appCss);
	return new Renderer({
		theme: {
			extend: {
				colors: themeColors
			}
		}
	});
}
```

### Phase 2: Publish Email Components to Registry

Publish shadcn-styled email components to jsrepo/shadcn-svelte registry.

**Components to publish:**

| Component      | Description                            | Variants                                 |
| -------------- | -------------------------------------- | ---------------------------------------- |
| `email-button` | CTA button matching shadcn Button      | default, destructive, secondary, outline |
| `email-card`   | Content container matching shadcn Card | -                                        |
| `email-badge`  | Status indicator matching shadcn Badge | default, secondary, destructive, outline |
| `email-footer` | Standard email footer                  | -                                        |

**Installation (user perspective):**

```bash
# Install from registry
npx shadcn-svelte add email-button
npx shadcn-svelte add email-card
```

**Component structure:**

```svelte
<!-- email-button.svelte -->
<script lang="ts">
	import { Button } from 'better-svelte-email/components';

	interface Props {
		href: string;
		variant?: 'default' | 'destructive' | 'secondary' | 'outline';
		size?: 'default' | 'sm' | 'lg';
		children: import('svelte').Snippet;
	}

	let { href, variant = 'default', size = 'default', children }: Props = $props();

	const variantClasses = {
		default: 'bg-primary text-primary-foreground',
		destructive: 'bg-destructive text-white',
		secondary: 'bg-secondary text-secondary-foreground',
		outline: 'border border-border bg-background text-foreground'
	};

	const sizeClasses = {
		default: 'px-4 py-2',
		sm: 'px-3 py-1.5 text-xs',
		lg: 'px-6 py-3'
	};
</script>

<Button
	{href}
	class="inline-block rounded-md text-sm font-medium no-underline {variantClasses[
		variant
	]} {sizeClasses[size]}"
>
	{@render children()}
</Button>
```

### Phase 3: Documentation & Examples

1. **README for better-svelte-email PR** - Document `createShadcnRenderer()` usage
2. **Registry component docs** - Installation and usage for each component
3. **Example templates** - VerificationEmail, PasswordResetEmail, WelcomeEmail

## Usage (After Implementation)

### 1. Install dependencies

```bash
bun add better-svelte-email
npx shadcn-svelte add email-button email-card email-badge
```

### 2. Create renderer

```typescript
// src/lib/emails/renderer.ts
import { createShadcnRenderer } from 'better-svelte-email/shadcn';

export const renderer = createShadcnRenderer();
```

### 3. Create email template

```svelte
<!-- src/lib/emails/VerificationEmail.svelte -->
<script lang="ts">
	import {
		Html,
		Head,
		Body,
		Container,
		Section,
		Text,
		Preview
	} from 'better-svelte-email/components';
	import EmailButton from '$lib/components/ui/email-button.svelte';
	import EmailCard from '$lib/components/ui/email-card.svelte';

	interface Props {
		code: string;
		expiryMinutes?: number;
	}

	let { code, expiryMinutes = 20 }: Props = $props();
</script>

<Html>
	<Head />
	<Preview preview="Your verification code is {code}" />
	<Body class="bg-background font-sans">
		<Container class="mx-auto max-w-[600px] py-10">
			<EmailCard>
				<Text class="text-2xl font-semibold text-foreground">Verify Your Email</Text>
				<Section class="my-6 rounded-lg bg-muted p-4 text-center">
					<Text class="text-3xl font-bold tracking-widest text-foreground">{code}</Text>
				</Section>
				<Text class="text-sm text-muted-foreground">
					This code expires in {expiryMinutes} minutes.
				</Text>
			</EmailCard>
		</Container>
	</Body>
</Html>
```

### 4. Render and send

```typescript
import { renderer } from '$lib/emails/renderer';
import VerificationEmail from '$lib/emails/VerificationEmail.svelte';

const html = await renderer.render(VerificationEmail, {
	props: { code: '123456', expiryMinutes: 20 }
});

await resend.emails.send({
	from: 'noreply@example.com',
	to: email,
	subject: 'Verify your email',
	html
});
```

## Benefits

1. **Single source of truth** - `app.css` defines all colors for both app and emails
2. **Build-time extraction** - No runtime file system access, serverless compatible
3. **Community reusable** - Components available via shadcn-svelte registry
4. **Consistent styling** - Email buttons look exactly like app buttons
5. **Easy updates** - Change `app.css`, rebuild, emails update

## File Structure (This Project)

```
src/lib/emails/
├── components/           # Local copies (from registry)
│   ├── email-button.svelte
│   ├── email-card.svelte
│   └── email-badge.svelte
├── VerificationEmail.svelte
├── PasswordResetEmail.svelte
├── WelcomeEmail.svelte
└── renderer.ts           # createShadcnRenderer() instance

src/routes/[[lang]]/admin/email/
└── [...email]/           # Email preview UI
    ├── +page.svelte
    └── +page.server.ts
```

## Timeline

| Phase | Task                                       | Status  |
| ----- | ------------------------------------------ | ------- |
| 1     | Create GitHub issue on better-svelte-email | Pending |
| 1     | Implement and submit PR                    | Pending |
| 2     | Prepare components for registry            | Pending |
| 2     | Publish to jsrepo/shadcn-svelte registry   | Pending |
| 3     | Write documentation                        | Pending |
| 3     | Create example templates                   | Pending |

## Links

- [better-svelte-email](https://github.com/Konixy/better-svelte-email)
- [shadcn-svelte](https://next.shadcn-svelte.com/)
- [jsrepo](https://jsrepo.dev/)
