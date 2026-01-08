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
# Skip for preview deployments - they use isolated Convex deployments that
# may not have all env vars set, and that's okay for testing
if [ "$VERCEL_ENV" = "production" ]; then
  echo "🔍 Checking required Convex environment variables..."

  CONVEX_ENV_LIST=$(convex env list 2>/dev/null || echo "")
  MISSING_VARS=""

  # Required environment variables
  REQUIRED_VARS="BETTER_AUTH_SECRET SITE_URL EMAIL_ASSET_URL AUTH_EMAIL AUTUMN_SECRET_KEY RESEND_API_KEY OPENROUTER_API_KEY RESEND_WEBHOOK_SECRET"

  for VAR in $REQUIRED_VARS; do
    if ! echo "$CONVEX_ENV_LIST" | grep -q "^${VAR}="; then
      MISSING_VARS="$MISSING_VARS $VAR"
    fi
  done

  if [ -n "$MISSING_VARS" ]; then
    echo ""
    echo "============================================================"
    echo "❌ MISSING REQUIRED CONVEX ENVIRONMENT VARIABLES"
    echo "============================================================"
    echo ""
    echo "The following variables are not set in your Convex environment:"
    for VAR in $MISSING_VARS; do
      echo "  - $VAR"
    done
    echo ""
    echo "Set them via CLI:"
    echo "  bunx convex env set VARIABLE_NAME value"
    echo ""
    echo "Or set in Convex Dashboard:"
    echo "  https://dashboard.convex.dev → Your Project → Settings → Environment Variables"
    echo ""
    echo "============================================================"
    exit 1
  fi

  echo "✅ All required environment variables are set"
else
  echo "⏭️  Skipping env var check for preview deployment"
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
