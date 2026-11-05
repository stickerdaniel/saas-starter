# Authentication

Users sign in with email and password, Google, GitHub, or a passkey. New accounts verify their email before they get access and are signed in automatically once they do. Password resets work out of the box. Google and GitHub appear once their OAuth keys are set; email and password works without any external service.

Auth runs on [Better Auth](https://www.better-auth.com/) as a [local Convex install](https://labs.convex.dev/better-auth/features/local-install), so users, sessions, and passkeys live in your own Convex deployment. Every route under `/app` needs a signed-in user and every route under `/admin` an admin. The server hook checks the role from the session token without an extra round-trip, and each backend function still checks authorization on its own.

Users manage their profile, password, email address, passkeys, and active sessions in the account settings.

## Where to start in the code

- [`src/lib/convex/auth.ts`](../../src/lib/convex/auth.ts): providers, verification, and signup side effects such as the welcome email
- [`src/hooks.server.ts`](../../src/hooks.server.ts): route protection for `/app` and `/admin`
- [Sign-in and sign-up pages](../../src/routes/%5B%5Blang%5D%5D/%28auth%29/)
- [Account settings](../../src/routes/%5B%5Blang%5D%5D/app/settings/)
- [Environment variables](../reference/environment.md): `BETTER_AUTH_SECRET` and the OAuth client IDs and secrets
