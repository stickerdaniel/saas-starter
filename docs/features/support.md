# Customer support

A support chat sits on every page. An AI agent answers product questions, collects bug reports, and walks users through setup. Users can attach images or PDFs and mark up a screenshot of the page before they send it.

When a question needs a human, the thread moves to you. Admins work threads in a three-pane support dashboard at `/admin/support` with assignment, priority levels, internal notes, and status tracking, and the user gets an email when an admin replies.

The agent runs on [Convex Agent](https://www.convex.dev/components/agent) with models from [OpenRouter](https://openrouter.ai/). Its behaviour starts from a seed prompt you rewrite for your product.

## Where to start in the code

- [`src/lib/convex/support/instructions.txt`](../../src/lib/convex/support/instructions.txt): the seed prompt
- [`src/lib/convex/support/`](../../src/lib/convex/support/): the agent, its tools, threads, and the handoff to a human
- [`src/lib/components/customer-support/`](../../src/lib/components/customer-support/): the chat users see
- [Support dashboard](../../src/routes/%5B%5Blang%5D%5D/admin/support/)
- [Screenshot proxy setup](../setup/customer-support/screenshot-proxy-setup.md): needed only when screenshots must include external images
- [Optimize the support prompt](../recipes/optimize-support-prompt.md): an optional recipe once you have resolved tickets
- [Environment variables](../reference/environment.md): `OPENROUTER_API_KEY`
