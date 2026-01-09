#!/bin/bash
set -e

echo "🌍 Vercel Environment: $VERCEL_ENV"

if [ "$VERCEL_ENV" = "production" ]; then
  echo "🏷️  Tagging production keys..."
  tolgee tag --filter-extracted --tag production --untag preview
elif [ "$VERCEL_ENV" = "preview" ]; then
  echo "🏷️  Tagging preview keys..."
  tolgee tag --filter-extracted --tag preview
else
  echo "⚠️  Unknown environment, skipping tagging"
fi

echo "📥 Pulling latest translations..."
tolgee pull

# =============================================================================
# Pre-deploy: Validate required Convex environment variables (production only)
# =============================================================================
# Skip for preview deployments - they have their own Convex instance with
# separately managed env vars, and the preview deployment doesn't exist yet
# when this check runs (it's created by `convex deploy`)
if [ "$VERCEL_ENV" = "production" ]; then
  echo "🔍 Checking required Convex environment variables..."
  bun src/lib/convex/env.ts --validate --prod
else
  echo "⏭️  Skipping env var check for $VERCEL_ENV deployment"

  # For preview deployments, set SITE_URL in Convex env before deploy
  # (Required for auth module to load - can't wait until --cmd runs)
  if [ -n "$VERCEL_URL" ] && [ -n "$VERCEL_GIT_COMMIT_REF" ]; then
    PREVIEW_SITE_URL="https://$VERCEL_URL"
    echo "📍 Setting SITE_URL for preview ($VERCEL_GIT_COMMIT_REF): $PREVIEW_SITE_URL"
    # Use --preview-name to target the preview deployment by branch name
    convex env set SITE_URL "$PREVIEW_SITE_URL" --preview-name "$VERCEL_GIT_COMMIT_REF" 2>/dev/null || {
      echo "   (Preview doesn't exist yet - set SITE_URL default in Convex Dashboard → Project Settings)"
    }
  fi
fi

echo "🚀 Deploying Convex and building SvelteKit..."
# Use --cmd-url-env-var-name to set PUBLIC_CONVEX_URL for SvelteKit
# Derive PUBLIC_CONVEX_SITE_URL from PUBLIC_CONVEX_URL (.convex.cloud -> .convex.site)
# Derive SITE_URL from VERCEL_URL for preview deployments (OAuth callbacks)
convex deploy --cmd-url-env-var-name PUBLIC_CONVEX_URL --cmd 'bash -c "
  if [ -n \"\$PUBLIC_CONVEX_URL\" ]; then
    export PUBLIC_CONVEX_SITE_URL=\"\${PUBLIC_CONVEX_URL/.convex.cloud/.convex.site}\"
    echo \"📍 PUBLIC_CONVEX_URL: \$PUBLIC_CONVEX_URL\"
    echo \"📍 PUBLIC_CONVEX_SITE_URL: \$PUBLIC_CONVEX_SITE_URL\"
  fi
  # For preview deployments, derive SITE_URL from VERCEL_URL if not already set
  if [ -z \"\$SITE_URL\" ] && [ -n \"\$VERCEL_URL\" ]; then
    export SITE_URL=\"https://\$VERCEL_URL\"
    echo \"📍 SITE_URL (from VERCEL_URL): \$SITE_URL\"
  fi
  bun run build
"'
