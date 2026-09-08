# create-saas-starter

Create a project from the verified [SaaS Starter](https://github.com/stickerdaniel/saas-starter) template.

```bash
npx create-saas-starter my-app
```

The CLI downloads one resolved GitHub revision, validates the complete archive before writing, and runs the template's public setup command before installing its locked dependencies. It never overwrites an existing path.

Use `create-saas-starter --help` for all options. Automated use must provide the required values and `--trust-template` explicitly. `--yes` does not grant trust or permission to overwrite. `--dry-run` performs local validation only, without prompts, network access, child processes, or writes.

The package requires Node.js 22.16.0 or newer. Setup and installation require Bun 1.3.9 or newer.
