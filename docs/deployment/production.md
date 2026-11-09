# Production deployment

Set the required platform and Convex production variables listed in the [environment variable matrix](../reference/environment.md).

- Platform: Project Settings > Environment Variables (CF Workers or Vercel)
- Convex: Select your Prod deployment > Settings > Environment Variables > Add

To run production on your own Node server instead, see [Self-hosted production](self-hosted.md). For your own domain, see [Custom domains](custom-domains.md).

## Deploy

Merge a reviewed pull request into your production branch (default: `main`) and the connected platform deploys the resulting push. Deployment is push-driven, so whatever the merge puts on that branch becomes the production build. Keeping review in that path is a maintainer procedure; what branch protection enforces is the narrower technical half described under [Preview deployments](previews.md), that a pull request's required checks passed on its tested candidate. Inspect intervening changes before merging an independent PR whose target has advanced. Verify or configure those settings separately for each fork, since they live in GitHub rather than in this repository and an organization rule may already supply some of them.

Each supported platform also has a manual deploy:

**Cloudflare Workers:**

```bash
bun scripts/cf-prod-deploy.ts
```

**Vercel:**

```bash
vercel --prod
```

## First Admin

Sign up on the site, then either set the user's role to `admin` in the Convex dashboard or run (with the email you signed up with):

```bash
bunx convex run admin/mutations:seedFirstAdmin '{"email":"you@example.com"}' --prod
```

## Resend webhook (optional)

For email event tracking (delivery, bounce, open, click):

1. Resend dashboard > Webhooks > Add Endpoint
2. URL: `https://<your-deployment>.convex.site/resend-webhook`
3. Select events: `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`
4. Copy the signing secret and set it on Convex: `bunx convex env set RESEND_WEBHOOK_SECRET <secret> --prod`
