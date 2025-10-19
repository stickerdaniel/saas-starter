#!/bin/bash
set -e

echo "🌍 Vercel Environment: $VERCEL_ENV"

if [ "$VERCEL_ENV" = "production" ]; then
  echo "🏷️  Tagging production keys..."
  bunx @tolgee/cli tag --filter-extracted --tag production --untag preview
elif [ "$VERCEL_ENV" = "preview" ]; then
  echo "🏷️  Tagging preview keys..."
  bunx @tolgee/cli tag --filter-extracted --tag preview
else
  echo "⚠️  Unknown environment, skipping tagging"
fi

echo "📥 Pulling latest translations..."
bunx @tolgee/cli pull

echo "🚀 Deploying Convex and building SvelteKit..."
bunx convex deploy --cmd 'bun run build'
