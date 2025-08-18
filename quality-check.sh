#!/bin/sh

# Unified quality check script
# Usage: 
#   ./quality-check.sh          - Check all files (for CI)
#   ./quality-check.sh --staged - Check only staged files (for pre-commit)

# error on first error
set -e

# Parse arguments
STAGED_ONLY=false
RUN_TESTS=true
RUN_BUILD=true

while [ $# -gt 0 ]; do
    case $1 in
        --staged)
            STAGED_ONLY=true
            RUN_TESTS=false
            RUN_BUILD=false
            shift
            ;;
        --no-tests)
            RUN_TESTS=false
            shift
            ;;
        --no-build)
            RUN_BUILD=false
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--staged] [--no-tests] [--no-build]"
            exit 1
            ;;
    esac
done

if [ "$STAGED_ONLY" = true ]; then
    ALL_FILES=$(git diff --cached --name-only --diff-filter=ACMR)
    if [ -z "$ALL_FILES" ]; then
        echo "No staged files to check"
        exit 0
    fi
    FILE_COUNT=$(echo "$ALL_FILES" | wc -l | xargs)
    echo "======================================================"
    echo "Quality Checks ($FILE_COUNT staged files)"
    echo "======================================================"
    JS_TS_SVELTE_FILES=$(echo "$ALL_FILES" | grep -E '\.(js|ts|svelte)$' || true)
    FORMATTABLE_FILES=$(echo "$ALL_FILES" | grep -E '\.(js|ts|svelte|html|css|md|json)$' || true)
    SVELTE_FILES=$(echo "$ALL_FILES" | grep -E '\.svelte$' || true)
else
    echo "======================================================"
    echo "Quality Checks (full project)"
    echo "======================================================"
    ALL_FILES="all"
    JS_TS_SVELTE_FILES="all"
    FORMATTABLE_FILES="all"
    SVELTE_FILES="all"
fi

echo ""

# SvelteKit sync
echo "1. SvelteKit sync"
echo "======================================================"
bunx svelte-kit sync
echo ""
echo ""

# Spell check
echo "2. Spell checking"
echo "======================================================"
if command -v misspell > /dev/null 2>&1; then
    if [ "$STAGED_ONLY" = true ]; then
        # Check only staged files
        STAGED_CHECKABLE_FILES=$(echo "$ALL_FILES" | grep -E '\.(js|ts|svelte|md)$' || true)
        if [ -n "$STAGED_CHECKABLE_FILES" ]; then
            echo "$STAGED_CHECKABLE_FILES" | xargs misspell -error
        else
            echo "No staged files to spell check"
        fi
    else
        # Check all files
        misspell -error ./src README.md
    fi
else
    echo "Installing misspell..."
    if command -v go > /dev/null 2>&1; then
        go install github.com/client9/misspell/cmd/misspell@latest
        export PATH=$PATH:$(go env GOPATH)/bin
        if [ "$STAGED_ONLY" = true ]; then
            STAGED_CHECKABLE_FILES=$(echo "$ALL_FILES" | grep -E '\.(js|ts|svelte|md)$' || true)
            if [ -n "$STAGED_CHECKABLE_FILES" ]; then
                echo "$STAGED_CHECKABLE_FILES" | xargs misspell -error
            else
                echo "No staged files to spell check"
            fi
        else
            misspell -error ./src README.md
        fi
    else
        echo "WARNING: misspell not installed (go required for installation)"
    fi
fi
echo ""
echo ""

# Format files
echo "3. Code formatting"
echo "======================================================"
if [ "$STAGED_ONLY" = true ] && [ -n "$FORMATTABLE_FILES" ]; then
    echo "$FORMATTABLE_FILES" | xargs bunx prettier --write --plugin prettier-plugin-svelte
elif [ "$STAGED_ONLY" = false ]; then
    bun run format
else
    echo "No files to format"
fi
echo ""
echo ""

# Linting
echo "4. ESLint"
echo "======================================================"
if [ "$STAGED_ONLY" = true ] && [ -n "$JS_TS_SVELTE_FILES" ]; then
    echo "$JS_TS_SVELTE_FILES" | xargs bunx eslint --fix
elif [ "$STAGED_ONLY" = false ]; then
    bunx eslint . --fix
else
    echo "No JS/TS/Svelte files to lint"
fi
echo ""
echo ""

# Type checking
echo "5. Type checking"
echo "======================================================"
if [ "$STAGED_ONLY" = true ] && [ -z "$JS_TS_SVELTE_FILES" ] && [ -z "$SVELTE_FILES" ]; then
    echo "No TypeScript/Svelte files to check"
else
    bunx svelte-check --tsconfig ./tsconfig.json
fi
echo ""
echo ""

# Tests (only in full mode)
if [ "$RUN_TESTS" = true ]; then
    echo "6. Tests"
    echo "======================================================"
    bun run test
    echo ""
    echo ""
fi

# Build check (only in full mode)
if [ "$RUN_BUILD" = true ]; then
    echo "7. Production build"
    echo "======================================================"
    bun run build
    echo ""
    echo ""
fi

# Re-stage files if they were modified during staged-only checks
if [ "$STAGED_ONLY" = true ]; then
    echo "Re-staging modified files..."
    # Only re-stage the files that were originally staged
    echo "$ALL_FILES" | xargs git add
    echo ""
fi

echo "======================================================"
echo "✓ All checks passed!"
echo "======================================================"