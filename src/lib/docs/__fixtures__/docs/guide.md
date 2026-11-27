# Fixture guide

This page exercises the docs engine. Its marker is saas-starter-docs-fixture-6f1d3a.

![Diagram in light mode](assets/diagram-light.gif#gh-light-mode-only)
![Diagram in dark mode](assets/diagram-dark.gif#gh-dark-mode-only)

[![The diagram, linked to the code page](assets/diagram-light.gif)](reference/code.md)

## Install the fixture

Read the [code page](reference/code.md) and its [highlighted line](reference/code.md#highlighted-lines). The catalog lives in [`catalog.ts`](../../catalog.ts), next to the [docs module](../../).

### Requirements

| Tool | Version |
| ---- | ------- |
| Bun  | 1.4     |
| Node | 24      |

### Example

The first example.

## Configure the fixture

### Example

The second example gets a suffixed anchor.

#### An _emphasis_ and `code` heading

Text below a heading with inline syntax.

## Headings in blocks

> ### A heading in a quote
>
> The quoted section holds a heading.
>
> #### A heading after a paragraph
>
> Its paragraph follows.

- ### A heading in a list item

  The listed section holds a heading.

##### A fifth-level heading

The deepest section of the guide.

## Blocks in blocks

> A quoted paragraph.
>
> ## A second level in a quote
>
> - A list in a quote
>
> A paragraph after the list.
>
> ### A third level in a quote
>
> :Term: A description with [a link](#alerts).
>
> ##### A fifth level in a quote
>
> A paragraph after the fifth level.
>
> ###### A sixth level in a quote
>
> ---
>
> ## A heading after a rule

- A list item
  - A nested item
    - A third level
- An item with a quote

  > A quote in an item

- An item with a table

  | Tool | Version |
  | ---- | ------- |
  | Bun  | 1.4     |

Water is H~2~O, the area is r^2^, ~~this word~~ is struck, and a note^[1](#alerts)^ links up.

- [x] A done task
- [ ] An open task

### A heading with [a link](#alerts)

A list mixes a task with an ordinary item:

- [x] A task beside an item
- An item beside a task

## Alerts

> [!NOTE]
> A note.

> [!TIP]
> A tip.

> [!IMPORTANT]
> Something important.

> [!WARNING]
> A warning.

> [!CAUTION]
> A caution.

## Deploy the fixture

### Cloudflare

The Worker build serves every page.

### Vercel

The function build serves every page.

### Node

The server build serves every page.

## Links outside the docs

Visit [the Svelte site](https://svelte.dev) or jump to [the alerts](#alerts).
