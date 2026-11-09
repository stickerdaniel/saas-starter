# Agents and SEO

## AI agents

When an AI agent asks a marketing page for `Accept: text/markdown`, it gets a structured markdown version with YAML frontmatter instead of HTML. An unknown public markdown URL returns a short markdown 404 with recovery links. `/llms.txt` lists the public pages, the developer resources, and the integrations the template does not expose by default, so an agent knows what it can and cannot do with your product.

The markdown variant sets `Vary: Accept` and stays private because CF Edge and most shared caches do not key on `Vary`.

## Search and social

Every page outputs OpenGraph tags and Twitter Cards. Indexable pages also get a canonical URL and `hreflang` alternates for all languages plus `x-default`; private and `noindex` pages leave both out. Sitemap dates come only from authored content metadata, and the localized homepages publish `WebSite` and `Organization` JSON-LD. The organization takes its name, postal address, and support email from `src/lib/config/legal.ts`.

The social card is `static/og-image.png` (1200x630). Replace it with your own and run `bun run generate:og-image-url`: the meta tags carry the image's content hash, which is what makes social platforms fetch the new card instead of the cached one for links that were already shared.

## Where to start in the code

- [`src/lib/markdown/marketing.ts`](../../src/lib/markdown/marketing.ts): markdown responses and `/llms.txt`
- [`src/lib/content/llms.txt`](../../src/lib/content/llms.txt): the authored `/llms.txt` template, including its access limits
- The `page.md.ts` file next to each marketing page, for example the [pricing page's](../../src/routes/%5B%5Blang%5D%5D/%28marketing%29/pricing/page.md.ts)
- [`src/lib/components/SEOHead.svelte`](../../src/lib/components/SEOHead.svelte) and [`src/lib/seo/structured-data.ts`](../../src/lib/seo/structured-data.ts)
- [`src/lib/config/site.ts`](../../src/lib/config/site.ts): publisher metadata and repository links
