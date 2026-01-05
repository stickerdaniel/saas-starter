# Reference Libraries

This directory contains git submodules of libraries used in this project. These are cloned here to provide AI coding agents with direct access to source code, ensuring accurate API usage and better code suggestions.

## Purpose

AI agents can read the actual source code of these libraries to:

- Understand the correct API signatures and types
- See implementation details for complex integrations
- Reference examples and patterns from the library
- Avoid hallucinating incorrect API usage

## Included Libraries

- **better-svelte-email** (`better-svelte-email/`) - Email template rendering with Svelte components

## Adding a New Reference Library

```bash
git submodule add <repository-url> docs/reference/<library-name>
```

## Updating Submodules

```bash
# Update all submodules to latest
git submodule update --remote --merge

# Update specific submodule
git submodule update --remote --merge docs/reference/<library-name>
```

## Cloning This Repository

When cloning this repository, initialize submodules:

```bash
git clone <repo-url>
cd <repo-name>
git submodule update --init --recursive
```

Or clone with submodules in one command:

```bash
git clone --recursive <repo-url>
```
