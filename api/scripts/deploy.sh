#!/bin/bash

# Echolon API Server Deployment Script
# Deploys to EC2 instance via rsync + PM2

set -euo pipefail

# Configuration from environment (set via .env.production)
KEYFILE="${KEYFILE:-}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/echolon-api}"
USER="${DEPLOY_USER:-ec2-user}"
PORT="${SSH_PORT:-22}"
SERVER_IP="${SERVER_IP:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║              Echolon API Server Deployment                ║${NC}"
echo -e "${YELLOW}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Validation
if [ -z "$SERVER_IP" ]; then
    echo -e "${RED}ERROR: SERVER_IP is not set. Check your .env.production file.${NC}"
    exit 1
fi

if [ -z "$KEYFILE" ]; then
    echo -e "${RED}ERROR: KEYFILE is not set. Check your .env.production file.${NC}"
    exit 1
fi

if [ ! -f "$KEYFILE" ]; then
    echo -e "${RED}ERROR: SSH key file not found at $KEYFILE${NC}"
    exit 1
fi

echo -e "${GREEN}Deploying to:${NC} $USER@$SERVER_IP:$DEPLOY_PATH"
echo ""

# Navigate to api directory
#cd "$(dirname "$0")/.."
echo -e "${YELLOW}Current directory:${NC} $(pwd)"

# Step 1: Build TypeScript
echo -e "${YELLOW}[1/5] Building TypeScript...${NC}"
npm run build
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Step 2: Prepare build directory
echo -e "${YELLOW}[2/5] Preparing deployment package...${NC}"
rm -rf build
mkdir -p build

# Copy necessary files
cp -R dist build/
cp package.json build/
cp package-lock.json build/
cp ecosystem.config.js build/

echo -e "${GREEN}✓ Package prepared${NC}"
echo ""

# Step 3: Sync files to server
echo -e "${YELLOW}[3/5] Syncing files to server...${NC}"
rsync -avz --delete \
    --exclude=".git" \
    --exclude="node_modules" \
    --exclude="src" \
      --no-times \
    --omit-dir-times \
    --no-perms \
    -e "ssh -i $KEYFILE -p $PORT" \
    build/ $USER@$SERVER_IP:$DEPLOY_PATH

echo -e "${GREEN}✓ Files synced${NC}"
echo ""

# Step 4: Install dependencies on server
echo -e "${YELLOW}[4/5] Installing dependencies...${NC}"
ssh $USER@$SERVER_IP -t -i $KEYFILE -p $PORT \
    "cd $DEPLOY_PATH && npm install --production"
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 5: Restart PM2
echo -e "${YELLOW}[5/5] Restarting PM2 process...${NC}"
ssh $USER@$SERVER_IP -t -i $KEYFILE -p $PORT \
    "cd $DEPLOY_PATH && pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js"
echo -e "${GREEN}✓ PM2 restarted${NC}"
echo ""

# Cleanup local build folder
rm -rf build

echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║               Deployment Complete!                        ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "API:          ${YELLOW}https://api.echolon.app${NC}"
echo -e "Health check: ${YELLOW}https://api.echolon.app/_internal/health${NC}"
echo -e "Version check: ${YELLOW}https://api.echolon.app/_internal/version${NC}"
echo -e "WebSocket:    ${YELLOW}wss://api.echolon.app/ws${NC}"
echo ""
