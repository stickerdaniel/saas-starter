#!/bin/bash

# Worktree management with Graphite integration
# Usage:
#   ./scripts/create-worktree.sh <branch-name>           # Full mode: create + setup
#   ./scripts/create-worktree.sh --setup-only            # Setup mode: setup only (for Cursor)

set -e

# Add node_modules/.bin to PATH for local binaries
export PATH="node_modules/.bin:$PATH"

# Parse arguments
SETUP_ONLY=false
BRANCH_NAME=""
OPEN_EDITOR=""

while [ $# -gt 0 ]; do
	case $1 in
		--setup-only)
			SETUP_ONLY=true
			shift
			;;
		--open-editor)
			OPEN_EDITOR=$2
			shift 2
			;;
		--help|-h)
			echo "Usage:"
			echo "  $0 <branch-name>               Create worktree with setup"
			echo "  $0 --setup-only                Setup only (for Cursor UI)"
			echo "  $0 <branch-name> --open-editor <editor>   Open in editor after creation"
			echo ""
			echo "Options:"
			echo "  --open-editor code|cursor      Open the worktree in VS Code or Cursor"
			echo ""
			echo "Example:"
			echo "  $0 feature-auth"
			echo "  $0 feature-auth --open-editor cursor"
			exit 0
			;;
		*)
			BRANCH_NAME=$1
			shift
			;;
	esac
done

# Function to get root worktree path
get_root_worktree() {
	# Get the main worktree path (where .git directory is)
	git rev-parse --show-toplevel
}

# Function to get default branch
get_default_branch() {
	# Try to get default branch from remote
	local default_branch=$(git symbolic-ref refs/remotes/origin/HEAD --short 2>/dev/null | sed 's#origin/##')

	# Fallback to 'main' if not set
	if [ -z "$default_branch" ]; then
		default_branch="main"
	fi

	echo "$default_branch"
}

# Function to setup worktree (copies files, installs deps, tracks with Graphite)
setup_worktree() {
	local ROOT_PATH=$1

	echo ""
	echo "======================================================"
	echo "Setting up worktree"
	echo "======================================================"
	echo ""

	# Copy .env.local if it exists
	if [ -f "$ROOT_PATH/.env.local" ]; then
		echo "📄 Copying .env.local..."
		cp "$ROOT_PATH/.env.local" .env.local
		echo "✅ .env.local copied"
	else
		echo "⚠️ No .env.local found in root worktree (skipping)"
	fi

	echo ""

	# Copy .env.test if it exists
	if [ -f "$ROOT_PATH/.env.test" ]; then
		echo "📄 Copying .env.test..."
		cp "$ROOT_PATH/.env.test" .env.test
		echo "✅ .env.test copied"
	else
		echo "⚠️ No .env.test found in root worktree (skipping)"
	fi

	echo ""

	# Copy .claude/settings.local.json if it exists
	if [ -f "$ROOT_PATH/.claude/settings.local.json" ]; then
		echo "📄 Copying .claude/settings.local.json..."
		mkdir -p .claude
		cp "$ROOT_PATH/.claude/settings.local.json" .claude/settings.local.json
		echo "✅ .claude/settings.local.json copied"
	else
		echo "⚠️ No .claude/settings.local.json found in root worktree (skipping)"
	fi

	echo ""
	echo "📦 Installing dependencies..."
	bun install
	echo "✅ Dependencies installed"

	echo ""
	echo "🔗 Tracking branch with Graphite..."
	gt track
	echo "✅ Branch tracked"

	echo ""
	echo "🔄 Syncing with trunk..."
	gt sync
	echo "✅ Synced with trunk"

	echo ""
	echo "======================================================"
	echo "✅ Worktree setup complete!"
	echo "======================================================"
	echo ""
	echo "Next steps:"
	echo "  1. Make your changes"
	echo "  2. Stage them: git add ."
	echo "  3. Commit changes: git commit -m \"feat: your feature\""
	echo "  4. Submit PR: gt submit"
	echo ""
	echo "To stack more changes on top:"
	echo "  1. Make more changes"
	echo "  2. git add ."
	echo "  3. gt create -m \"feat: another feature\"  # Creates new branch"
	echo "  4. gt submit --stack"
	echo ""
}

# SETUP-ONLY MODE (for Cursor UI)
if [ "$SETUP_ONLY" = true ]; then
	ROOT_PATH=$(get_root_worktree)
	setup_worktree "$ROOT_PATH"
	exit 0
fi

# FULL MODE (create + setup)

# Validate branch name
if [ -z "$BRANCH_NAME" ]; then
	echo "❌ Error: Branch name is required"
	echo ""
	echo "Usage: $0 <branch-name>"
	echo "Example: $0 feature-auth"
	exit 1
fi

echo ""
echo "======================================================"
echo "Creating worktree: $BRANCH_NAME"
echo "======================================================"
echo ""

# Get root worktree path
ROOT_PATH=$(get_root_worktree)
echo "📂 Root worktree: $ROOT_PATH"

# Determine target worktree path
WORKTREE_PATH=$(dirname "$ROOT_PATH")/"$BRANCH_NAME"
echo "📂 Target worktree: $WORKTREE_PATH"
echo ""

# Check if worktree already exists
if [ -d "$WORKTREE_PATH" ]; then
	echo "❌ Error: Worktree directory already exists: $WORKTREE_PATH"
	echo ""
	echo "Options:"
	echo "  1. Choose a different branch name"
	echo "  2. Remove existing directory: rm -rf $WORKTREE_PATH"
	echo "  3. List worktrees: git worktree list"
	exit 1
fi

# Get default branch
DEFAULT_BRANCH=$(get_default_branch)
echo "📍 Base branch: $DEFAULT_BRANCH"

# Create worktree
echo "🪾 Creating git worktree..."
git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" "$DEFAULT_BRANCH"
echo "✅ Worktree created"

# Change to new worktree
cd "$WORKTREE_PATH"

# Run setup
setup_worktree "$ROOT_PATH"

echo "📍 Worktree location: $WORKTREE_PATH"
echo ""

# Open in editor if requested
if [ -n "$OPEN_EDITOR" ]; then
	echo "🚀 Opening in $OPEN_EDITOR..."
	case $OPEN_EDITOR in
		code)
			code "$WORKTREE_PATH"
			;;
		cursor)
			cursor "$WORKTREE_PATH"
			;;
		*)
			echo "⚠️ Unknown editor: $OPEN_EDITOR (supported: code, cursor)"
			;;
	esac
	echo ""
else
	echo "To work in this worktree:"
	echo "  cd $WORKTREE_PATH"
	echo ""
fi
