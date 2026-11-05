# Admin

Admins get their own area at `/admin`. The dashboard shows live metrics such as total users, active sessions, and recent signups. The users table is searchable, filterable, and sortable, and every user has actions to ban or unban them, change their role, revoke their sessions, or impersonate them to see the product as they see it. Each of those actions lands in an audit log.

Admins can also get an email when a customer pays for the first time, with a timeline of what that customer did before paying, and another when a paying customer cancels. Each admin chooses which of these emails they receive in `/admin/settings`. The emails need the Autumn webhook from [the admin customer emails guide](../setup/admin-notifications/customer-emails.md).

The settings page also holds the founder welcome email, see [Email](email.md), and the support dashboard is described under [Customer support](support.md).

## Where to start in the code

- [Admin routes](../../src/routes/%5B%5Blang%5D%5D/admin/): dashboard, users, audit log, settings, and support
- [`src/lib/convex/admin/`](../../src/lib/convex/admin/): admin queries and mutations, the audit log, and the customer emails
- [`src/hooks.server.ts`](../../src/hooks.server.ts): only admins reach `/admin`
- [First admin](../deployment/production.md#first-admin): promote the first account in production
