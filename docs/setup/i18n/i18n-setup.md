# Internationalization (i18n) Setup Guide

This project uses **Tolgee** for cloud-hosted translation management with SEO-friendly URL-based localization. Tolgee Cloud is **optional** -- the app works out of the box with committed JSON translation files.

## Tolgee Cloud is Optional

This template includes **many translation keys that exceed Tolgee Cloud's free tier** (500 keys on the free plan, this project has ~740). You have three options:

### Option 1: Skip Tolgee Entirely (Easiest)

No Tolgee account needed. Edit translation files directly in `src/i18n/{lang}.json` and commit them. The deploy script detects that `TOLGEE_API_KEY` is not set and builds using committed JSON files as-is.

- In-context editing (Alt+Click) is not available without Tolgee
- Translation management is done through your editor and version control
- No external service dependency

### Option 2: Delete Unused Keys

If you want to use Tolgee Cloud's free tier, remove translations you don't need via the Tolgee dashboard to stay within the 500-key limit.

### Option 3: Self-Host Tolgee

Self-hosting gives you unlimited keys and full control. The easiest way is using **Coolify's one-click deploy**:

1. **Deploy Tolgee** via Coolify's one-click template or Docker:
   - Coolify: Use the Tolgee service template
   - Docker: See [Tolgee self-hosting docs](https://tolgee.io/platform/self_hosting/running_with_docker)

2. **Update `.tolgeerc`** with your instance URL:

   ```json
   {
   	"apiUrl": "https://tolgee.yourdomain.com",
   	"format": "JSON_TOLGEE",
   	"patterns": ["src/**/*.{ts,svelte}"],
   	"push": {
   		"filesTemplate": "./src/i18n/{languageTag}.json"
   	},
   	"pull": {
   		"path": "./src/i18n"
   	}
   }
   ```

3. **Update `.env.local`**:

   ```bash
   VITE_TOLGEE_API_URL=https://tolgee.yourdomain.com
   VITE_TOLGEE_API_KEY=your_self_hosted_api_key
   ```

4. **Generate a new API key** in your self-hosted Tolgee instance (Project Settings → API keys)

5. **Update Vercel environment variables** with the new `TOLGEE_API_KEY`

That's it! The deploy script (`scripts/deploy.ts`) automatically reads from `.tolgeerc`, so no code changes needed.

## Quick Start

### 1. Set Up Tolgee Cloud

1. Create a free account at [app.tolgee.io](https://app.tolgee.io)
2. Create a new project
3. Go to **Project Settings → API keys → Create API key**
4. Copy your API key and add it to `.env.local`:

```bash
VITE_TOLGEE_API_KEY=your_api_key_here
```

### 2. Add Translations

1. Log in to your Tolgee project at [app.tolgee.io](https://app.tolgee.io)
2. Add translation keys and values for each language (en, de, es, fr)
3. Or use the **in-context editor** in development mode (see below)

### 3. Run the Development Server

```bash
bun run dev
```

Open the local URL printed in the dev server output (the port is deterministic per project/worktree, see `scripts/dev-ports.ts`) and you'll be redirected to `/en` (or your browser's preferred language).

## How It Works

### URL Structure

All routes are now prefixed with a language code:

- `/en/` - English (default)
- `/de/` - German
- `/es/` - Spanish
- `/fr/` - French

Examples:

- `/en/app/dashboard` - Dashboard in English
- `/de/pricing` - Pricing page in German
- `/fr/signin` - Sign in page in French

### In-Context Translation (Development Only)

In development mode, **Tolgee DevTools** are automatically enabled:

1. Hold `Alt` (or `Option` on Mac) and click any translated text
2. Edit translations directly in your browser
3. Changes are saved to Tolgee Cloud instantly

**Note:** DevTools are automatically disabled in production builds.

## Using Translations in Your Code

### Method 1: `<T>` Component (Recommended)

**Basic Example:**

```svelte
<script lang="ts">
	import { T } from '@tolgee/svelte';
</script>

<T keyName="welcome_message" />

<!-- With parameters -->
<T keyName="greeting" params={{ name: 'John' }} />

<!-- With default fallback -->
<T keyName="new_key" defaultValue="This is a fallback" />
```

**Practical Example - Hero Section:**

```svelte
<script lang="ts">
	import { T } from '@tolgee/svelte';
</script>

<section class="hero">
	<h1><T keyName="hero.title" defaultValue="SaaS Starter Template" /></h1>
	<p><T keyName="hero.tagline" defaultValue="Focus on your product and ship faster." /></p>
	<button><T keyName="hero.cta" defaultValue="Get Started" /></button>
</section>
```

**Adding Translations in Tolgee Cloud:**

1. Go to https://app.tolgee.io and open your project
2. Click "Add Key" and create: `hero.tagline`
3. Add translations for each language:
   - **en**: "Focus on your product and ship faster."
   - **de**: "Konzentrieren Sie sich auf Ihr Produkt und versenden Sie schneller."
   - **es**: "Céntrate en tu product y envía más rápido."
   - **fr**: "Concentrez-vous sur votre produit et expédiez plus rapidement."

### Method 2: `getTranslate` Function

For more complex scenarios or when you need the translation in TypeScript code:

```svelte
<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';

	const { t, isLoading } = getTranslate();
</script>

{#if $isLoading}
	<p>Loading translations...</p>
{:else}
	<h1>{$t('page_title')}</h1>
	<p>{$t('description', { count: 5 })}</p>
{/if}
```

## Language Switcher

The project uses the **Language Switcher** component from `@ieedan/shadcn-svelte-extras`, wrapped with Tolgee integration.

### Basic Usage

Add the language switcher to your navigation:

```svelte
<script lang="ts">
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
</script>

<nav>
	<!-- Your nav items -->
	<LanguageSwitcher />
</nav>
```

### Customization

The component accepts optional props:

```svelte
<LanguageSwitcher
	variant="ghost"    <!-- 'outline' (default) or 'ghost' -->
	align="start"      <!-- 'start', 'center', or 'end' (default) -->
	class="ml-4"       <!-- Additional CSS classes -->
/>
```

### How It Works

The language switcher automatically:

- Shows all available languages with flags and names
- Displays as a globe icon button with dropdown
- Preserves the current page path when switching (e.g., `/en/pricing` → `/de/pricing`)
- Preserves search parameters
- Updates Tolgee's language state
- Uses shadcn-svelte design system for consistent styling

## Using the Tolgee CLI

The Tolgee CLI allows you to manage translations from the command line.

### CLI Commands

```bash
# Push translations to Tolgee Cloud
bunx tolgee push

# Pull translations from Tolgee Cloud
bunx tolgee pull

# Extract translation keys from code
bunx tolgee extract

# Sync: extract + push in one command
bunx tolgee sync
```

### Setup

The CLI is already installed and configured with:

- **Config:** `.tolgeerc` (committed, holds `apiUrl`, format, and push/pull paths, no secrets)
- **Translations:** `src/i18n/{language}.json` files

The API key is never stored in the config file. The `i18n:*` package scripts pass it from the `VITE_TOLGEE_API_KEY` env var (loaded by varlock), so set that in `.env.local` before running any CLI command.

### Workflow Options

**Option A: In-Context Editing (Easiest)**

1. Add `<T keyName="..." defaultValue="..." />` in your code
2. Run dev server: `bun run dev`
3. Alt+Click on text to edit translations in-browser
4. Pull translations: `bunx tolgee pull`

**Option B: Push Local Files**

1. Edit `src/i18n/{language}.json` files locally
2. Push to cloud: `bunx tolgee push`
3. View/edit in Tolgee Cloud dashboard

**Option C: Extract from Code**

1. Add `<T>` components with `defaultValue` throughout your code
2. Extract keys: `bunx tolgee extract`
3. Push to cloud: `bunx tolgee push`
4. Translate in Tolgee Cloud
5. Pull for production: `bunx tolgee pull`

### Example Translation Files

Example files have been created in `src/i18n/`:

- `en.json` - English translations
- `de.json` - German translations
- `es.json` - Spanish translations
- `fr.json` - French translations

## Adding/Removing Languages

### To Add a Language

1. Add the language metadata to the canonical registry in `src/lib/i18n/languages.ts` and add its `src/i18n/<code>.json` translation file:

```typescript
export const SUPPORTED_LANGUAGES: Language[] = [
	// ... existing languages
	{
		code: 'ja',
		name: '日本語',
		nameEn: 'Japanese',
		flag: '🇯🇵'
	}
];
```

2. Generate every derived registration and Cloudflare route:

```bash
bun run i18n:sync
```

The application, SvelteKit prerendering, Tolgee, and Convex read the canonical registry/shared generated translations. `scripts/prerender-sync.test.ts` fails if the translation files or generated outputs drift.

### To Remove a Language

1. Remove the language from `SUPPORTED_LANGUAGES` and delete its locale JSON file.
2. Run `bun run i18n:sync`.

## SEO Features

The `SEOHead` component automatically adds:

✅ **Hreflang tags** for all languages
✅ **Canonical URLs** with language prefix
✅ **Open Graph locale tags**
✅ **x-default** hreflang for default language

### Custom SEO per Page

```svelte
<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
</script>

<SEOHead title="Pricing" description="Choose the plan that fits your needs" />
```

## Production Setup

### Important: Never Use API Keys in Production!

For production, use one of these methods:

### Option 1: Static Translation Export (Recommended, already wired up)

The root `src/routes/+layout.svelte` already imports the committed JSON files and passes them to Tolgee as `staticData`, so production builds ship translations bundled, with no API key required at runtime:

```typescript
import de from '../i18n/de.json';
import en from '../i18n/en.json';
import es from '../i18n/es.json';
import fr from '../i18n/fr.json';

const translations: TolgeeStaticData = { en, de, es, fr };

const tolgee = Tolgee()
	.use(FormatIcu())
	.init({
		language: currentLang,
		staticData: translations,
		availableLanguages: ['en', 'de', 'es', 'fr'],
		defaultLanguage: 'en',
		fallbackLanguage: 'en'
	});
```

The `apiUrl`/`apiKey` options are only read in development for in-context editing, so to keep these files current, pull the latest translations before building:

```bash
bun run i18n:pull
```

### Option 2: Tolgee Content Delivery (CDN)

Use Tolgee's CDN for production (requires paid plan):

- No API key needed
- Faster content delivery
- See [Tolgee docs](https://tolgee.io/platform/projects_and_organizations/cdn) for setup

## Language Detection

When users visit the root URL (`/`), they are automatically redirected based on:

1. **Accept-Language header** from browser
2. Falls back to **English (en)** if no match

Example:

- Browser language: German → Redirected to `/de`
- Browser language: Japanese (not supported) → Redirected to `/en`

## Troubleshooting

### Translations Not Loading

1. Verify `VITE_TOLGEE_API_KEY` is set in `.env.local`
2. Check Tolgee project has translations for all languages
3. Check browser console for errors

### DevTools Not Appearing

- DevTools only work in development mode
- Make sure `VITE_TOLGEE_API_KEY` is set
- DevTools are automatically enabled in the root `src/routes/+layout.svelte`

### 404 on Language Routes

- Ensure the language code exists in `SUPPORTED_LANGUAGES`
- Check that routes are in `src/routes/[[lang]]/` directory
- Verify `[[lang]]` uses double brackets (not single)

## File Structure

```
src/
├── lib/
│   ├── components/
│   │   ├── LanguageSwitcher.svelte  # Language dropdown
│   │   └── SEOHead.svelte            # SEO meta tags
│   └── i18n/
│       └── languages.ts              # Language configuration
├── routes/
│   ├── [[lang]]/                     # All localized routes
│   │   ├── +layout.ts                # Language validation
│   │   ├── +layout.svelte            # OAuth bootstrap
│   │   ├── (auth)/
│   │   ├── (marketing)/
│   │   └── app/
│   └── +layout.svelte                # Root layout: TolgeeProvider, static data, SEO
└── hooks.server.ts                   # Language detection & redirects
```

## Resources

- [Tolgee Documentation](https://tolgee.io/platform)
- [Tolgee Svelte Integration](https://tolgee.io/integrations/svelte)
- [SvelteKit i18n Guide](https://kit.svelte.dev/docs/routing#advanced-routing-matching)
