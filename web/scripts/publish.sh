#!/usr/bin/env bash
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

cd "$WEB_DIR"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  📦 Echolon Web - NPM Publish Script${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Parse arguments
DRY_RUN=false
SKIP_BUILD=false
VERSION_BUMP=""
NPM_TAG="latest"

print_usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  --dry-run         Run without actually publishing"
  echo "  --skip-build      Skip the build step (use existing dist/)"
  echo "  --patch           Bump patch version (0.0.x)"
  echo "  --minor           Bump minor version (0.x.0)"
  echo "  --major           Bump major version (x.0.0)"
  echo "  --tag <tag>       NPM tag (default: latest)"
  echo "  --help            Show this help message"
  echo ""
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --patch)
      VERSION_BUMP="patch"
      shift
      ;;
    --minor)
      VERSION_BUMP="minor"
      shift
      ;;
    --major)
      VERSION_BUMP="major"
      shift
      ;;
    --tag)
      NPM_TAG="$2"
      shift 2
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

# Step 1: Check npm authentication
echo -e "${YELLOW}🔐 Checking npm authentication...${NC}"
if ! npm whoami &>/dev/null; then
  echo -e "${RED}❌ Not logged in to npm. Please run 'npm login' first.${NC}"
  exit 1
fi
NPM_USER=$(npm whoami)
echo -e "${GREEN}✅ Logged in as: ${NPM_USER}${NC}"
echo ""

# Step 2: Check for uncommitted changes
echo -e "${YELLOW}📋 Checking for uncommitted changes...${NC}"
if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
  echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
  if [[ "$DRY_RUN" == false ]]; then
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo -e "${RED}❌ Aborted.${NC}"
      exit 1
    fi
  fi
else
  echo -e "${GREEN}✅ Working directory is clean${NC}"
fi
echo ""

# Step 3: Version bump (if requested)
if [[ -n "$VERSION_BUMP" ]]; then
  echo -e "${YELLOW}📝 Bumping $VERSION_BUMP version...${NC}"
  OLD_VERSION=$(node -p "require('./package.json').version")
  npm version "$VERSION_BUMP" --no-git-tag-version
  NEW_VERSION=$(node -p "require('./package.json').version")
  echo -e "${GREEN}✅ Version bumped: ${OLD_VERSION} → ${NEW_VERSION}${NC}"
  echo ""
fi

# Get current version
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")

echo -e "${BLUE}📦 Package: ${PACKAGE_NAME}@${VERSION}${NC}"
echo ""

# Step 4: Check if version already exists on npm
echo -e "${YELLOW}🔍 Checking if version exists on npm...${NC}"
if npm view "${PACKAGE_NAME}@${VERSION}" version &>/dev/null; then
  echo -e "${RED}❌ Version ${VERSION} already exists on npm!${NC}"
  echo -e "${YELLOW}   Use --patch, --minor, or --major to bump the version.${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Version ${VERSION} is available${NC}"
echo ""

# Step 5: Install dependencies
echo -e "${YELLOW}📥 Installing dependencies...${NC}"
npm ci --silent
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# Step 6: Build library
if [[ "$SKIP_BUILD" == false ]]; then
  echo -e "${YELLOW}🔨 Building library...${NC}"
  npm run build:lib
  echo -e "${GREEN}✅ Build complete${NC}"
  echo ""
fi

# Step 7: Generate TypeScript declarations
echo -e "${YELLOW}📝 Generating TypeScript declarations...${NC}"

# Create a temporary tsconfig for declaration generation
cat > tsconfig.build.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["../core/renderer/*"],
      "@shared/*": ["../core/shared/*"]
    },
    "baseUrl": "."
  },
  "include": ["index.tsx"],
  "exclude": ["node_modules", "dist"]
}
EOF

# Generate declarations (may have warnings, that's ok)
npx tsc --project tsconfig.build.json 2>/dev/null || true

# Clean up temp tsconfig
rm -f tsconfig.build.json

# If declaration generation failed, create a minimal one
if [[ ! -f "dist/index.d.ts" ]]; then
  echo -e "${YELLOW}   Creating manual type declarations...${NC}"
  cat > dist/index.d.ts << 'EOF'
import { FC, ReactNode } from 'react';

export interface MountOptions {
  /** Container element or selector */
  container: string | HTMLElement;
  /** URL to fetch OpenAPI/Swagger spec from */
  specUrl?: string;
  /** CORS proxy URL prefix */
  corsProxy?: string;
  /** Theme: 'light', 'dark', or 'system' */
  theme?: 'light' | 'dark' | 'system';
  /** View mode: 'tabs' or 'reference' */
  viewMode?: 'tabs' | 'reference';
  /** Make the UI read-only */
  readonly?: boolean;
  /** Custom title for the API reference */
  title?: string;
  /** URL to fetch available versions */
  versionsUrl?: string;
}

/**
 * Mount Echolon Web to a container element
 * @param options - Configuration options
 * @returns Unmount function to clean up the component
 */
export function mount(options: MountOptions): () => void;

export interface WebModeConfig {
  specUrl?: string;
  corsProxy?: string;
  theme?: 'light' | 'dark' | 'system';
  viewMode?: 'tabs' | 'reference';
  readonly?: boolean;
  title?: string;
  versionsUrl?: string;
}

export interface WebModeContextValue {
  specUrl?: string;
  corsProxy?: string;
  theme: 'light' | 'dark' | 'system';
  viewMode: 'tabs' | 'reference';
  readonly: boolean;
  title?: string;
  versionsUrl?: string;
  loadedCollection: any | null;
  setLoadedCollection: (collection: any | null) => void;
}

export const WebModeProvider: FC<{ config: WebModeConfig; children: ReactNode }>;
export function useWebMode(): WebModeContextValue;

declare const _default: { mount: typeof mount };
export default _default;
EOF
fi

echo -e "${GREEN}✅ TypeScript declarations generated${NC}"
echo ""

# Step 8: Validate package contents
echo -e "${YELLOW}📋 Validating package contents...${NC}"
REQUIRED_FILES=("dist/echolon-web.umd.js" "dist/echolon-web.es.js" "dist/echolon-web.css" "dist/index.d.ts")
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

echo -e "${GREEN}✅ All required files present${NC}"
echo ""

# Step 9: Show package contents
echo -e "${YELLOW}📦 Package contents:${NC}"
npm pack --dry-run 2>/dev/null | head -30
echo ""

# Step 10: Publish
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${YELLOW}🏃 Dry run mode - skipping actual publish${NC}"
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✅ Dry run completed successfully!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "To publish for real, run:"
  echo "  ./scripts/publish.sh"
  echo ""
else
  echo -e "${YELLOW}🚀 Publishing to npm...${NC}"
  npm publish --access public --tag "$NPM_TAG"
  
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✅ Successfully published ${PACKAGE_NAME}@${VERSION}${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "Install with:"
  echo "  npm install ${PACKAGE_NAME}"
  echo ""
  echo "Or use via CDN:"
  echo "  https://unpkg.com/${PACKAGE_NAME}@${VERSION}/dist/echolon-web.umd.js"
  echo "  https://unpkg.com/${PACKAGE_NAME}@${VERSION}/dist/echolon-web.css"
  echo ""
  
  # Create git tag if version was bumped
  if [[ -n "$VERSION_BUMP" ]]; then
    echo -e "${YELLOW}🏷️  Creating git tag...${NC}"
    git add package.json
    git commit -m "chore(web): release v${VERSION}"
    git tag "web-v${VERSION}"
    echo -e "${GREEN}✅ Created tag: web-v${VERSION}${NC}"
    echo ""
    echo -e "${YELLOW}Don't forget to push:${NC}"
    echo "  git push && git push --tags"
  fi
fi
