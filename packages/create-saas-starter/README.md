# create-saas-starter

Create a project from the verified [SaaS Starter](https://github.com/stickerdaniel/saas-starter) template.

```bash
npm create saas-starter@latest my-app
```

Alternatively, use `bun create saas-starter@latest my-app` or `npx create-saas-starter@latest my-app`.

Without arguments, the CLI interactively prompts for the target, project and repository branding, legal details, and template trust.

The CLI downloads one resolved GitHub revision, validates the complete archive before writing, and runs the template's public setup command before installing its locked dependencies. It never overwrites an existing path.

Use `create-saas-starter --help` for all options. Automated use must provide the required values and `--trust-template` explicitly. `--yes` does not grant trust or permission to overwrite. `--dry-run` performs local validation only, without prompts, network access, child processes, or writes.

The package requires Node.js 22.16.0 or newer. Setup and installation require Bun 1.3.9 or newer. Archive writes and template commands run in a protected per-user staging directory. The completed project is published through an exclusive final claim, so replacing the requested target cannot redirect setup execution. Windows staging stays inside the current user profile and supports cross-volume publication; its final ready marker is committed only after every other entry. POSIX staging requires root/current-user ownership and sticky protection for shared writable ancestors, and falls back to a protected target-parent staging path when the OS temp directory is on another filesystem.
