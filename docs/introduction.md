# Introduction

saas-starter is an open-source SvelteKit and Convex template for building your SaaS and running it after launch.

Most starters end where the real work starts: your first customer. This one also tells you who paid, who is stuck, and who was hit by a bug. It runs in production at [Cadenza](https://cadenza.page), the hosted version of [LinkedIn MCP](https://github.com/stickerdaniel/linkedin-mcp-server).

## Why you can build on it

- **Nothing lands here on spec.** A feature only moves into the template once one of my products uses it in production.
- **Fixes reach every product.** Cadenza has reviewed 158 template commits in three syncs and taken over 120 of them, among them a checkout bug that silently dead-ended every upgrade path. Each was fixed once, here.
- **It stays maintained** because my own products run on it. When the base breaks, my products break first.
- **Fixes stay fixed.** When the right fix was not obvious and the mistake is still easy to write, the fix ships with a guard at the earliest point that catches it again: a type, a lint rule, a static check or a focused test. CI asks every fix for its verdict. [How guards work](development.md#regression-guards).

## The feedback loop after launch

Each step is wired in. The conversations stay yours.

| Step                 | What the template does                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch               | Pushes deploy, and pull requests get previews. Analytics, error tracking and admin metrics are wired in before your first user.                           |
| Talk to users        | New users get a personal welcome email from you, and replies reach your inbox. The support AI answers and hands you threads that need a human.            |
| Learn what they do   | You get an email when a customer first pays, with what they did before paying. People who never paid and customers who cancel are asked what was missing. |
| Fix it and tell them | After a production fix, an agent can find who the evidence shows was hit and draft one email for you to approve.                                          |

Each step needs its service, such as Resend for email or the Autumn webhook for payments, and some steps also need a setting in the admin area. The [feature pages](features/README.md) list what each one needs.

Under that: auth with passkeys and OAuth, plan limits with an upgrade path, admin with impersonation and an audit log, markdown pages and `/llms.txt` for AI agents, four languages, and automated WCAG 2.1 AA checks in the test suite. [All features](features/README.md).

## Staying up to date

Your product is its own repository with its own branding and features. Template changes still reach it, and your fixes can travel back:

- **Down:** `bun run upstream:sync` finds where your product split off, `bun run upstream:changes` lists every template commit since, and an agent skill reviews each one against what your product changed.
- **Up:** `bun run upstream:report` measures which of your fixes touched template code, so you can send the ones that matter back and every product gets them.

Pick how your product receives template changes before you create it: [update models](update-models.md).

## Next steps

- [Getting started](getting-started.md): create a project, run it locally, and rebrand it.
- [Deployment](deployment/README.md): previews per pull request, production, and custom domains.
- [Environment variables](reference/environment.md): every variable and where it is set.
