# Internationalization (i18n) Setup Guide

This project uses **Tolgee** for cloud-hosted translation management with SEO-friendly URL-based localization.

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

Visit [http://localhost:5173](http://localhost:5173) and you'll be redirected to `/en` (or your browser's preferred language).

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

- **File:** `.tolgee.json` (contains your API key and project configuration)
- **Translations:** `src/i18n/{language}.json` files

**⚠️ Important:** `.tolgee.json` contains your API key and is excluded from git via `.gitignore`.

### Configuration

Before using CLI commands, update your **Project ID** in `.tolgee.json`:

1. Go to https://app.tolgee.io
2. Open your project
3. Go to **Settings** → find your **Project ID**
4. Update `.tolgee.json`:
   ```json
   {
     "projectId": YOUR_PROJECT_ID_HERE,
     ...
   }
   ```

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

1. Update `src/lib/i18n/languages.ts`:

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

2. Update `src/routes/[[lang]]/+layout.svelte`:

```typescript
availableLanguages: ['en', 'de', 'es', 'fr', 'ja'],
```

3. Add translations in Tolgee Cloud for the new language

### To Remove a Language

1. Remove from `SUPPORTED_LANGUAGES` in `src/lib/i18n/languages.ts`
2. Remove from `availableLanguages` in `src/routes/[[lang]]/+layout.svelte`

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

<SEOHead title="About Us" description="Learn more about our company" />
```

## Production Setup

### Important: Never Use API Keys in Production!

For production, use one of these methods:

### Option 1: Static Translation Export (Recommended)

1. Install Tolgee CLI:

   ```bash
   bun add -g @tolgee/cli
   ```

2. Export translations:

   ```bash
   bunx tolgee pull
   ```

3. Update `src/routes/[[lang]]/+layout.svelte` to use static data:

   ```typescript
   import enTranslations from './i18n/en.json';
   import deTranslations from './i18n/de.json';
   // ...

   const tolgee = Tolgee()
   	.use(FormatSimple())
   	.init({
   		language: data.lang,
   		staticData: {
   			en: enTranslations,
   			de: deTranslations
   			// ...
   		}
   	});
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
- DevTools component is automatically added in `[[lang]]/+layout.svelte`

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
│   │   ├── +layout.svelte            # TolgeeProvider setup
│   │   ├── (auth)/
│   │   ├── (marketing)/
│   │   └── app/
│   └── +layout.svelte                # Root layout with SEO
└── hooks.server.ts                   # Language detection & redirects
```

## Resources

- [Tolgee Documentation](https://tolgee.io/platform)
- [Tolgee Svelte Integration](https://tolgee.io/integrations/svelte)
- [SvelteKit i18n Guide](https://kit.svelte.dev/docs/routing#advanced-routing-matching)
