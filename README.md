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

### 2. Set up Convex

```bash
# Initialize Convex project
bunx convex dev

# Set up authentication
bun run setupAuth.mjs
```

### 3. Environment Variables

Create `.env.local`:

```bash
CONVEX_DEPLOYMENT=your-deployment-name
PUBLIC_CONVEX_URL=https://your-deployment-name.convex.cloud
```

### 4. OAuth Providers (Optional)

#### Google OAuth Setup

1. Create a Google OAuth app in the [Google Cloud Console](https://console.cloud.google.com/)
2. Set callback URL: `https://[your-deployment-name].convex.site/api/auth/callback/google`
3. Set environment variables:

```bash
bunx convex env set AUTH_GOOGLE_ID your_google_client_id
bunx convex env set AUTH_GOOGLE_SECRET your_google_client_secret
```

### 5. Email Configuration (Required for Auth)

This project uses [Resend](https://resend.com/) for production-ready email delivery.

#### Setup Resend

1. **Create a Resend account** at [resend.com](https://resend.com/)
2. **Get your API key** from the Resend dashboard
3. **Verify your domain** (or use `onboarding@resend.dev` for testing)

#### Configure Environment Variables

```bash
# Set your Resend API key
bunx convex env set RESEND_API_KEY re_xxxxxxxxxxxx

# Set your sender email address
bunx convex env set AUTH_EMAIL "noreply@yourdomain.com"
```

**For testing:** You can use `onboarding@resend.dev` as your sender while in development.

#### Email Features

- ✅ **Automatic Queuing** - Reliably handles email delivery
- ✅ **Durable Execution** - Survives server restarts
- ✅ **Idempotency** - Prevents duplicate sends
- ✅ **Event Tracking** - Track deliveries, bounces, spam complaints
- ✅ **Test Mode** - Safe development with delivery restrictions

#### Webhook Setup (Optional)

For email event tracking (delivery confirmations, bounces, etc.):

1. Go to your Resend dashboard → Webhooks
2. Add a new webhook endpoint:
   ```
   https://your-deployment-name.convex.site/resend-webhook
   ```
3. Select events to track (delivered, bounced, complained, etc.)
4. Copy the webhook signing secret
5. Set the secret in Convex:
   ```bash
   bunx convex env set RESEND_WEBHOOK_SECRET whsec_xxxxxxxxxxxx
   ```

### 6. Run Development Server

```bash
bun run dev
```

Visit `http://localhost:5173` to see your app!

## Available Scripts

- `bun run dev` - Start development server
- `bun run build` - Build for production
- `bun run preview` - Preview production build
- `bun run test` - Run all tests (E2E + unit)
- `bun run test:e2e` - Run E2E tests only
- `bun run test:unit` - Run unit tests only
- `bun run lint` - Lint code
- `bun run format` - Format code

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
   # Copy the example file
   cp .env.test.example .env.test

   # Edit .env.test and ensure it contains:
   # AUTH_E2E_TEST_SECRET=test-secret
   # PUBLIC_E2E_TEST=true
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
     - `TEST_CONVEX_URL`: Your development Convex URL (for running tests)
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

**Note:** CI/CD tests run against the development Convex deployment to keep production data clean. The `TEST_CONVEX_URL` secret points to your development environment while `PUBLIC_CONVEX_URL` is used for production deployments.

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
