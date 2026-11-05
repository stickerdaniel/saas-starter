# Deployment

**Start on free tiers. Deploy to Cloudflare/Vercel, or your own Node server.**

Deployment is push-driven. A connected hosting platform builds every push: a branch becomes a preview with its own Convex preview backend, and the production branch becomes the production build. Cloudflare Workers, Vercel, and Coolify builds run [`scripts/deploy.ts`](../../scripts/deploy.ts), which deploys the matching Convex backend and derives the frontend's Convex URLs from it. The deploy keys live in the hosting platform's build settings.

| Page                                                 | Covers                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| [Preview deployments](previews.md)                   | One preview per pull request, branch protection, preview cleanup   |
| [Cloudflare Workers](cloudflare.md)                  | Workers Builds setup and the post-deploy edge cache purge          |
| [Vercel](vercel.md)                                  | Connecting the repository to Vercel                                |
| [Production deployment](production.md)               | Production variables, deploys, the first admin, the Resend webhook |
| [Self-hosted production](self-hosted.md)             | Coolify and the Node container                                     |
| [Custom domains](custom-domains.md)                  | Cloudflare DNS, Cloudflare for SaaS, and cache headers             |
| [Environment variables](../reference/environment.md) | Every variable and where it is set                                 |
