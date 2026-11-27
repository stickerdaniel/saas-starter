# Changelog

## 0.2.1

- A new project includes the template's test suite by default. `--without-tests` leaves it out.
- `--without-tests` on a template revision without `tests` in `templateProfiles` fails before the CLI writes anything, and the error names the revision.
- The CLI refuses `--with-tests` as an unknown option.
- After a failed setup or install, the output contains the commands for a repeat, also for a project with the test suite.

## 0.2.0

- A new project leaves out the template's test suite by default. `--with-tests` keeps it.
- The CLI reads `templateProfiles` from the template's `package.json` and refuses a value that is not a list of distinct known names before it writes anything.
- A template revision without `templateProfiles` still yields its full project, and the CLI says so in one line.
- With `--skip-install`, a project without tests needs `bun install` first and `bun install --frozen-lockfile` as the check after it. The CLI prints both.
- The default template revision is `29ef7d453fd4ed170f30b176857c560347f619a3`.
