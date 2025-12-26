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

echo "🚀 Deploying Convex and building SvelteKit..."
convex deploy --cmd 'bun run build'
