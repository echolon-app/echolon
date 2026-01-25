#!/usr/bin/env bash
# Usage: cd web

# Attach to release: attaches the build to the release
# npm run attach:release -- --tag v1.0.9
# Skip build: uses existing dist/ folder
# npm run attach:release -- --tag v1.0.9 --skip-build
# Dry run: shows what would be uploaded without uploading
# npm run attach:release -- --tag v1.0.9 --dry-run
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$WEB_DIR/../.." && pwd)"

cd "$WEB_DIR"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  📦 Attach Web Build to GitHub Release${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Parse arguments
SKIP_BUILD=false
RELEASE_TAG=""
DRY_RUN=false
SKIP_RELEASE_ASSETS=false

print_usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  --tag <tag>            GitHub release tag (e.g., v1.0.9)"
  echo "  --skip-build           Skip the build step (use existing dist/)"
  echo "  --skip-release-assets  Skip uploading as release assets (only commit to git)"
  echo "  --dry-run              Show what would be uploaded without uploading"
  echo "  --help                 Show this help message"
  echo ""
  echo "Example:"
  echo "  $0 --tag v1.0.9"
  echo ""
  echo "Note: Release assets are optional. jsDelivr works from committed files."
  echo ""
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --tag)
      RELEASE_TAG="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-release-assets)
      SKIP_RELEASE_ASSETS=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help)
      print_usage
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      print_usage
      exit 1
      ;;
  esac
done

# Validate release tag
if [[ -z "$RELEASE_TAG" ]]; then
  echo -e "${RED}❌ Error: --tag is required${NC}"
  print_usage
  exit 1
fi

# Extract version from tag (remove 'v' prefix)
VERSION="${RELEASE_TAG#v}"

echo -e "${BLUE}📦 Release Tag: ${RELEASE_TAG}${NC}"
echo -e "${BLUE}📦 Version: ${VERSION}${NC}"
echo ""

# Step 1: Build library
if [[ "$SKIP_BUILD" == false ]]; then
  echo -e "${YELLOW}🔨 Building web library...${NC}"
  npm run build:lib
  echo -e "${GREEN}✅ Build complete${NC}"
  echo ""
fi

# Step 2: Validate build files exist
echo -e "${YELLOW}📋 Validating build files...${NC}"
REQUIRED_FILES=("dist/echolon-web.umd.js" "dist/echolon-web.es.js" "dist/echolon-web.css")
OPTIONAL_FILES=("dist/index.d.ts")
MISSING_FILES=()

for file in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    MISSING_FILES+=("$file")
  fi
done

if [[ ${#MISSING_FILES[@]} -gt 0 ]]; then
  echo -e "${RED}❌ Missing required files:${NC}"
  for file in "${MISSING_FILES[@]}"; do
    echo -e "   - $file"
  done
  exit 1
fi

echo -e "${GREEN}✅ All required build files present${NC}"

# Check for optional files
for file in "${OPTIONAL_FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo -e "${YELLOW}⚠️  Optional file not found: ${file}${NC}"
    echo -e "${YELLOW}   (This is okay - TypeScript definitions are optional for CDN usage)${NC}"
  fi
done
echo ""

# Step 3: Check for GitHub CLI
if command -v gh &> /dev/null; then
  echo -e "${GREEN}✅ GitHub CLI (gh) found${NC}"
  USE_GH_CLI=true
else
  echo -e "${YELLOW}⚠️  GitHub CLI (gh) not found${NC}"
  echo -e "${YELLOW}   Install it from: https://cli.github.com/${NC}"
  echo -e "${YELLOW}   Or use the manual upload method below${NC}"
  USE_GH_CLI=false
fi
echo ""

# Step 4: Upload to GitHub release
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${YELLOW}🏃 Dry run mode - showing what would be uploaded:${NC}"
  echo ""
  echo -e "${BLUE}Required files:${NC}"
  for file in "${REQUIRED_FILES[@]}"; do
    SIZE=$(du -h "$file" | cut -f1)
    echo -e "   ${GREEN}✓${NC} $file (${SIZE})"
  done
  echo ""
  echo -e "${BLUE}Optional files:${NC}"
  for file in "${OPTIONAL_FILES[@]}"; do
    if [[ -f "$file" ]]; then
      SIZE=$(du -h "$file" | cut -f1)
      echo -e "   ${GREEN}✓${NC} $file (${SIZE})"
    else
      echo -e "   ${YELLOW}○${NC} $file (not found - will be skipped)"
    fi
  done
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✅ Dry run completed!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "To upload for real, run:"
  echo "  $0 --tag $RELEASE_TAG"
  exit 0
fi

if [[ "$USE_GH_CLI" == true ]]; then
  echo -e "${YELLOW}📤 Committing files to repository for jsDelivr CDN...${NC}"
  
  # Check if we're in a git repository
  if ! git rev-parse --git-dir &>/dev/null; then
    echo -e "${RED}❌ Not in a git repository!${NC}"
    exit 1
  fi
  
  # Check if tag already exists locally
  TAG_EXISTS_LOCAL=false
  if git rev-parse "$RELEASE_TAG" &>/dev/null; then
    TAG_EXISTS_LOCAL=true
    echo -e "${YELLOW}⚠️  Tag ${RELEASE_TAG} already exists locally${NC}"
  fi
  
  # Check if tag exists remotely
  TAG_EXISTS_REMOTE=false
  if git ls-remote --tags origin "$RELEASE_TAG" | grep -q "$RELEASE_TAG"; then
    TAG_EXISTS_REMOTE=true
    echo -e "${YELLOW}⚠️  Tag ${RELEASE_TAG} already exists remotely${NC}"
  fi
  
  if [[ "$TAG_EXISTS_LOCAL" == true ]] || [[ "$TAG_EXISTS_REMOTE" == true ]]; then
    echo -e "${YELLOW}   Will update it with new build files${NC}"
  fi
  
  # Get current branch
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  echo -e "${BLUE}   Current branch: ${CURRENT_BRANCH}${NC}"
  
  # Stage the dist files (force add even if in .gitignore)
  echo -e "${YELLOW}   Staging dist files...${NC}"
  git add -f "${REQUIRED_FILES[@]}"
  if [[ -f "${OPTIONAL_FILES[0]}" ]]; then
    git add -f "${OPTIONAL_FILES[0]}"
  fi
  
  # Check if there are changes to commit
  if git diff --cached --quiet; then
    echo -e "${YELLOW}⚠️  No changes to commit (files are already up to date)${NC}"
  else
    # Commit the files
    echo -e "${YELLOW}   Committing dist files...${NC}"
    git commit -m "chore(web): add build files for ${RELEASE_TAG}" || {
      echo -e "${RED}❌ Failed to commit files${NC}"
      exit 1
    }
  fi
  
  # Create or update the tag (always force update locally)
  if [[ "$TAG_EXISTS_LOCAL" == true ]]; then
    echo -e "${YELLOW}   Updating local tag ${RELEASE_TAG}...${NC}"
    git tag -f "$RELEASE_TAG" || {
      echo -e "${RED}❌ Failed to update tag${NC}"
      exit 1
    }
  else
    echo -e "${YELLOW}   Creating tag ${RELEASE_TAG}...${NC}"
    git tag "$RELEASE_TAG" || {
      echo -e "${RED}❌ Failed to create tag${NC}"
      exit 1
    }
  fi
  
  # Push the commit and tag
  echo -e "${YELLOW}   Pushing commit to GitHub...${NC}"
  git push origin "$CURRENT_BRANCH" || {
    echo -e "${RED}❌ Failed to push commit${NC}"
    exit 1
  }
  
  # Always use --force when pushing tags (since we're intentionally updating them)
  echo -e "${YELLOW}   Pushing tag ${RELEASE_TAG} to GitHub...${NC}"
  git push origin "$RELEASE_TAG" --force || {
    echo -e "${RED}❌ Failed to push tag${NC}"
    exit 1
  }
  
  echo -e "${GREEN}✅ Files committed and tagged in repository${NC}"
  echo ""
  
  # Upload as release assets (optional - only for GitHub release page)
  if [[ "$SKIP_RELEASE_ASSETS" == false ]]; then
    echo -e "${YELLOW}📤 Uploading files as release assets (optional)...${NC}"
    
    # Check if release exists, create if not
    if ! gh release view "$RELEASE_TAG" &>/dev/null; then
      echo -e "${YELLOW}   Creating release ${RELEASE_TAG}...${NC}"
      gh release create "$RELEASE_TAG" --title "Echolon ${VERSION}" --notes "Release ${VERSION}" || {
        echo -e "${YELLOW}⚠️  Failed to create release (tag already exists as release?)${NC}"
      }
    fi
    
    # Upload required files as release assets
    for file in "${REQUIRED_FILES[@]}"; do
      echo -e "   Uploading ${file} as release asset..."
      gh release upload "$RELEASE_TAG" "$file" --clobber 2>/dev/null || {
        echo -e "${YELLOW}⚠️  Failed to upload ${file} (may already exist)${NC}"
      }
    done
    
    # Upload optional files if they exist
    for file in "${OPTIONAL_FILES[@]}"; do
      if [[ -f "$file" ]]; then
        echo -e "   Uploading optional file ${file}..."
        gh release upload "$RELEASE_TAG" "$file" --clobber 2>/dev/null || {
          echo -e "${YELLOW}⚠️  Failed to upload ${file}${NC}"
        }
      fi
    done
    
    echo ""
  else
    echo -e "${BLUE}ℹ️  Skipping release asset upload (not required for jsDelivr)${NC}"
    echo ""
  fi
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✅ Successfully prepared web build for CDN!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${BLUE}📦 jsDelivr CDN URLs (available after a few minutes):${NC}"
  echo ""
  echo "CSS:"
  echo "  https://cdn.jsdelivr.net/gh/echolon-app/echolon@${RELEASE_TAG}/web/dist/echolon-web.css"
  echo ""
  echo "JavaScript (UMD):"
  echo "  https://cdn.jsdelivr.net/gh/echolon-app/echolon@${RELEASE_TAG}/web/dist/echolon-web.umd.js"
  echo ""
  echo "JavaScript (ES Module):"
  echo "  https://cdn.jsdelivr.net/gh/echolon-app/echolon@${RELEASE_TAG}/web/dist/echolon-web.es.js"
  echo ""
  echo -e "${YELLOW}ℹ️  Note: jsDelivr may take a few minutes to index the new files${NC}"
  echo ""
fi