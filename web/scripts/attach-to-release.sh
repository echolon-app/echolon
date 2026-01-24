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

print_usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  --tag <tag>        GitHub release tag (e.g., v1.0.9)"
  echo "  --skip-build       Skip the build step (use existing dist/)"
  echo "  --dry-run          Show what would be uploaded without uploading"
  echo "  --help             Show this help message"
  echo ""
  echo "Example:"
  echo "  $0 --tag v1.0.9"
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
  echo -e "${YELLOW}📤 Uploading files to GitHub release ${RELEASE_TAG}...${NC}"
  
  # Check if release exists
  if ! gh release view "$RELEASE_TAG" &>/dev/null; then
    echo -e "${RED}❌ Release ${RELEASE_TAG} does not exist!${NC}"
    echo -e "${YELLOW}   Create it first with:${NC}"
    echo -e "   gh release create ${RELEASE_TAG} --title \"Echolon ${VERSION}\" --notes \"Release ${VERSION}\""
    exit 1
  fi
  
  # Upload required files
  for file in "${REQUIRED_FILES[@]}"; do
    echo -e "   Uploading ${file}..."
    gh release upload "$RELEASE_TAG" "$file" --clobber
  done
  
  # Upload optional files if they exist
  for file in "${OPTIONAL_FILES[@]}"; do
    if [[ -f "$file" ]]; then
      echo -e "   Uploading ${file}..."
      gh release upload "$RELEASE_TAG" "$file" --clobber
    fi
  done
  
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✅ Successfully uploaded web build to release!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${BLUE}📦 jsDelivr CDN URLs:${NC}"
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
else
  echo -e "${YELLOW}📋 Manual upload instructions:${NC}"
  echo ""
  echo "1. Go to: https://github.com/echolon-app/echolon/releases/tag/${RELEASE_TAG}"
  echo "2. Click 'Edit release'"
  echo "3. Drag and drop these files:"
  echo ""
  echo -e "${BLUE}Required files:${NC}"
  for file in "${REQUIRED_FILES[@]}"; do
    FULL_PATH=$(realpath "$file")
    echo "   - $FULL_PATH"
  done
  echo ""
  echo -e "${BLUE}Optional files (if available):${NC}"
  for file in "${OPTIONAL_FILES[@]}"; do
    if [[ -f "$file" ]]; then
      FULL_PATH=$(realpath "$file")
      echo "   - $FULL_PATH"
    fi
  done
  echo ""
  echo "4. Save the release"
  echo ""
  echo -e "${BLUE}📦 After uploading, use these jsDelivr URLs:${NC}"
  echo ""
  echo "CSS:"
  echo "  https://cdn.jsdelivr.net/gh/echolon-app/echolon@${RELEASE_TAG}/web/dist/echolon-web.css"
  echo ""
  echo "JavaScript:"
  echo "  https://cdn.jsdelivr.net/gh/echolon-app/echolon@${RELEASE_TAG}/web/dist/echolon-web.umd.js"
  echo ""
fi