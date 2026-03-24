# SaaS Starter

A full-stack SaaS starter template built with SvelteKit, Convex, and modern web technologies.

## Features

- 🔐 **Authentication** - Complete auth system with OAuth (Google) and email/password
- 📧 **Email System** - Production-ready email delivery with Resend (queuing, durability, tracking)
- 💬 **Real-time Chat** - Demo chat application with live messaging
- 🎨 **Modern UI** - Tailwind CSS + Skeleton UI components
- ⚡ **Fast Backend** - Convex for real-time data and serverless functions
- 🧪 **Testing** - E2E testing with Playwright and unit tests with Vitest
- 📱 **Responsive** - Mobile-first design
- 🔧 **Developer Experience** - TypeScript, ESLint, Prettier, Husky

## Tech Stack

- **Frontend**: SvelteKit, Svelte 5, Tailwind CSS, Skeleton UI
- **Backend**: Convex (real-time database + serverless functions)
- **Authentication**: Convex Auth with OAuth providers
- **Testing**: Playwright (E2E), Vitest (unit)
- **Development**: TypeScript, ESLint, Prettier, Husky

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd saas-starter
bun install
```

### 2. Run Local Development

```bash
bun run dev
```

That's it. A local Convex backend starts automatically with a seeded admin account:

- **Email:** `admin@local.dev`
- **Password:** `LocalDevAdmin123!`

Visit `http://localhost:5173`, sign in, and explore.

### 3. Optional Services (`.env.convex.local`)

Create `.env.convex.local` at the project root to enable optional services in local dev:

```bash
# Email (signup, verification, password reset)
RESEND_API_KEY=re_xxxxxxxxxxxx
AUTH_EMAIL=noreply@yourdomain.com
EMAIL_ASSET_URL=https://yourdomain.com

# OAuth
AUTH_GOOGLE_ID=your-client-id
AUTH_GOOGLE_SECRET=your-client-secret
AUTH_GITHUB_ID=your-client-id
AUTH_GITHUB_SECRET=your-client-secret

# AI support chat
OPENROUTER_API_KEY=sk-or-v1-xxxx

# Billing
AUTUMN_SECRET_KEY=am_sk_xxxx
```

Without these, the app boots fine using the seeded admin. Email, OAuth, AI, and billing features are simply inactive.

### 4. Cloud Development

For cloud Convex (shared dev database, CI/CD):

1. Initialize a Convex project: `bunx convex init`
2. Add `CONVEX_DEPLOYMENT` to `.env.local`
3. Run: `bun run dev:cloud`
4. Set backend vars: `bunx convex env set KEY value` (see `.env-convex.schema` for all vars)

### 5. Email Configuration

This project uses [Resend](https://resend.com/) for email delivery:

1. Create a Resend account at [resend.com](https://resend.com/)
2. Get your API key and verify your domain
3. Set vars in `.env.convex.local` (local) or via `bunx convex env set` (cloud)

Email features: automatic queuing, durable execution, idempotency, event tracking, test mode.

### 6. Set Up First Admin (Cloud Only)

In local dev, the seeded admin is created automatically. For cloud deployments:

1. Sign up with the email you want to be admin
2. Run: `bunx convex run admin/mutations:seedFirstAdmin '{"email":"your-email@example.com"}'`

After the first admin, promote additional admins via the Admin Panel.

## Available Scripts

- `bun run dev` - Start local dev (Convex backend embedded)
- `bun run dev:cloud` - Start cloud dev (requires `CONVEX_DEPLOYMENT`)
- `bun run build` - Build for production
- `bun run preview` - Preview production build
- `bun run test` - Run all tests (E2E + unit)
- `bun run test:e2e` - Run E2E tests only
- `bun run test:unit` - Run unit tests only
- `bun run lint` - Lint code
- `bun run format` - Format code

## Environment Variables

Two separate runtimes, two schemas:

| File                 | Runtime        | Description           |
| -------------------- | -------------- | --------------------- |
| `.env.schema`        | SvelteKit      | Frontend/Vercel vars  |
| `.env-convex.schema` | Convex backend | Backend function vars |

Runtime env files:

| File                | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `.env.local`        | SvelteKit vars (Vite loads automatically) |
| `.env.convex.local` | Convex backend vars for local dev         |

For cloud Convex, set vars via `bunx convex env set KEY value` (dev) or `bunx convex env set KEY value --prod` (production).

## Project Structure

```
src/
├── lib/
│   ├── convex/          # Convex backend functions and schema
│   ├── demo/            # Demo chat application components
│   ├── svelte/          # Svelte auth components
│   └── sveltekit/       # SvelteKit auth utilities
├── routes/
│   ├── +layout.svelte   # Root layout with auth setup
│   ├── +page.svelte     # Home page
│   ├── product/         # Protected product page
│   └── signin/          # Sign-in page
└── app.html             # HTML template
```

## Authentication

This starter includes a complete authentication system:

- **OAuth Providers**: Google (easily extendable to others)
- **Email/Password**: Traditional email authentication
- **Route Protection**: Protect pages or entire app sections
- **Server-side Auth**: Full SSR support with auth state

See [SvelteKit Auth Documentation](src/lib/sveltekit/README.md) for detailed setup and usage.

## Database & Backend

Powered by [Convex](https://convex.dev/):

- **Real-time**: Automatic live updates
- **Serverless**: No server management needed
- **TypeScript**: End-to-end type safety
- **Queries & Mutations**: Reactive data layer

See [Convex Documentation](src/lib/convex/README.md) for schema and functions.

## Testing

### E2E Testing

#### Setup

1. **Configure test environment variables:**

   ```bash
   # Create .env.test with test-specific overrides (see .env.schema for all vars)
   # Required:
   # AUTH_E2E_TEST_SECRET=test-secret
   # PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
   ```

2. **Configure Convex backend:**

   ```bash
   # Set the test secret in your Convex deployment
   bunx convex env set AUTH_E2E_TEST_SECRET test-secret

   # Initialize test data
   bunx convex run tests:init
   ```

3. **For GitHub Actions (CI/CD):**
   - Go to your repository Settings → Secrets and variables → Actions
   - Add the following repository secrets:
     - `AUTH_E2E_TEST_SECRET`: Set to `test-secret`
     - `PUBLIC_CONVEX_URL`: Your production Convex URL (for deployment)
   - Tests run against the development environment to keep production clean
   - This is already configured in `.github/workflows/quality-checks.yml`

4. **Install Playwright and run tests:**

   ```bash
   # Install Playwright
   bunx playwright install

   # Run tests
   bun run test:e2e
   ```

**Important:** The `AUTH_E2E_TEST_SECRET` must be configured in three places:

- Local `.env.test` file (for local development)
- Convex development backend (for test authentication) - NOT in production
- GitHub Secrets (for CI/CD)

**Note:** CI/CD tests use preview deployments with dynamic URL discovery via `.well-known/e2e-config.json`. No separate `TEST_CONVEX_URL` is needed.

### Unit Testing

```bash
bun run test:unit
```

## Deployment

### Deploy to Vercel

#### Setup

1. **Get your Convex deployment URL and deploy key:**
   - Your Convex URL: Check `.env.local` for `PUBLIC_CONVEX_URL` (e.g., `https://intent-snake-818.convex.cloud`)
   - Generate deploy key: Go to [Convex Dashboard](https://dashboard.convex.dev) → Settings → Deploy Keys → Generate Production Deploy Key

2. **Set environment variables in Vercel:**

   <details>
   <summary><strong>Free Tier Setup</strong> (using development Convex for previews)</summary>

   Without Convex Pro, preview deployments should use your **development** Convex deployment while production uses your **production** deployment.

   **Using Vercel CLI:**

   ```bash
   # Production environment (uses production Convex)
   echo "https://your-prod-deployment.convex.cloud" | vercel env add PUBLIC_CONVEX_URL production
   echo "prod:your-prod-deployment|your-prod-key" | vercel env add CONVEX_DEPLOY_KEY production

   # Preview environment (uses development Convex)
   echo "https://your-dev-deployment.convex.cloud" | vercel env add PUBLIC_CONVEX_URL preview
   echo "dev:your-dev-deployment|your-dev-key" | vercel env add CONVEX_DEPLOY_KEY preview
   ```

   **Or via Vercel Dashboard:**
   - Go to your project → Settings → Environment Variables

   For **Production**:
   - Add `PUBLIC_CONVEX_URL`: Your production Convex URL
     - Environment: **Production only**
   - Add `CONVEX_DEPLOY_KEY`: Your production deploy key (`prod:...`)
     - Environment: **Production only**

   For **Preview** (PR deployments):
   - Add `PUBLIC_CONVEX_URL`: Your development Convex URL
     - Environment: **Preview only**
   - Add `CONVEX_DEPLOY_KEY`: Your development deploy key (`dev:...`)
     - Environment: **Preview only**

   **Why this setup?**
   - Free tier doesn't support separate preview Convex deployments
   - Preview/PR deployments use your development database (safe for testing)
   - Production deployments use your production database (real data)

   </details>

   <details>
   <summary><strong>Convex Pro Setup</strong> (dedicated preview deployments)</summary>

   With Convex Pro, you can create separate preview deployments for each PR.

   **Using Vercel CLI:**

   ```bash
   # Set production Convex for both environments
   echo "https://your-deployment.convex.cloud" | vercel env add PUBLIC_CONVEX_URL production preview
   echo "prod:your-deployment|your-key" | vercel env add CONVEX_DEPLOY_KEY production preview
   ```

   **Or via Vercel Dashboard:**
   - Go to your project → Settings → Environment Variables
   - Add `PUBLIC_CONVEX_URL`: Your production Convex URL
     - Select **both "Production" and "Preview"** environments
   - Add `CONVEX_DEPLOY_KEY`: Your production deploy key
     - Select **both "Production" and "Preview"** environments

   See [Convex Preview Deployments](https://docs.convex.dev/production/hosting/preview-deployments) for more details.

   </details>

3. **Configure Build Command:**

   <details>
   <summary><strong>⚠️ Important: Override the build command</strong> (click to expand)</summary>

   Vercel needs to deploy your Convex functions before building SvelteKit to generate the required `_generated` files.

   **Via Vercel Dashboard (Recommended):**
   1. Go to your project → Settings → General
   2. Scroll to "Framework Settings" → "Build & Development Settings"
   3. Find "Build Command" under **Project Settings** section
   4. Enable the "Override" toggle
   5. Enter: `bunx convex deploy --cmd 'bun run build'`
   6. Click "Save"

   **Why this is needed:**
   - The `_generated` directory is gitignored (as it should be)
   - `bunx convex deploy` deploys your Convex functions and generates these files
   - Then it runs `bun run build` to build your SvelteKit app
   - Without this, your build will fail with `ENOENT: no such file or directory` errors

   **Note:** Use the **Project Settings** section (not Production Overrides) so both production and preview deployments work correctly.

   </details>

4. **Deploy:**
   ```bash
   vercel --prod
   ```

#### Development Workflow

With `CONVEX_DEPLOY_KEY` set, your workflow is simple:

```bash
bunx convex dev         # Updates dev deployment locally
# Make changes
git push                # Automatically deploys BOTH frontend + Convex functions to production
```

#### What Each Environment Variable Does

- **PUBLIC_CONVEX_URL**: Enables frontend to connect to your Convex backend (required)
- **CONVEX_DEPLOY_KEY**: Enables automatic Convex function deployment with each Vercel build (required for full functionality)

### Set Production Environment Variables

```bash
# Set production OAuth credentials
bunx convex env set AUTH_GOOGLE_ID your_google_client_id --prod
bunx convex env set AUTH_GOOGLE_SECRET your_google_client_secret --prod

# Set production email configuration
bunx convex env set RESEND_API_KEY your_resend_api_key --prod
bunx convex env set AUTH_EMAIL "noreply@yourdomain.com" --prod
bunx convex env set RESEND_WEBHOOK_SECRET your_webhook_secret --prod
```

### Set Up Production Admin

After deploying to production, set up your first admin:

1. **Sign up** on your production site with your admin email
2. **Run the seed command** against production:

   ```bash
   bunx convex run admin/mutations:seedFirstAdmin '{"email":"admin@yourdomain.com"}' --prod
   ```

This enables access to the Admin Panel at `/admin`.

## Customization

### Adding New Auth Providers

1. Follow [Convex Auth documentation](https://docs.convex.dev/auth) to add providers
2. Update `src/lib/convex/auth.config.ts`
3. Add sign-in buttons to your UI

### Styling

- Modify `src/app.css` for global styles
- Customize Tailwind configuration in `tailwind.config.js`

### Database Schema

- Edit `src/lib/convex/schema.ts` to add your data models
- Create new functions in `src/lib/convex/` for your business logic

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see the [LICENSE](LICENSE) file for details.
