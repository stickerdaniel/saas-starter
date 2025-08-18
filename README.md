# SaaS Starter

A full-stack SaaS starter template built with SvelteKit, Convex, and modern web technologies.

## Features

- 🔐 **Authentication** - Complete auth system with OAuth (Google) and email/password
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

### 5. Run Development Server

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

```bash
# Setup test environment
bunx convex env set AUTH_E2E_TEST_SECRET test-secret

# Add to .env.test
PUBLIC_E2E_TEST=true

# Initialize test data
bunx convex run tests:init

# Install Playwright
bunx playwright install

# Run tests
bun run test:e2e
```

### Unit Testing

```bash
bun run test:unit
```

## Deployment

### Deploy to Vercel

1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy!

### Deploy Convex

```bash
# Deploy to production
bunx convex deploy

# Set production environment variables
bunx convex env set AUTH_GOOGLE_ID your_google_client_id --prod
bunx convex env set AUTH_GOOGLE_SECRET your_google_client_secret --prod
```

## Customization

### Adding New Auth Providers

1. Follow [Convex Auth documentation](https://docs.convex.dev/auth) to add providers
2. Update `src/lib/convex/auth.config.ts`
3. Add sign-in buttons to your UI

### Styling

- Modify `src/app.css` for global styles
- Use [Skeleton UI components](https://skeleton.dev/) for consistent design
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