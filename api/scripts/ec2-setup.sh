#!/bin/bash

# Echolon Proxy Server - EC2 Initial Setup Script
# Run this on a fresh EC2 Amazon Linux 2 instance

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║        Echolon Proxy Server - EC2 Setup                   ║${NC}"
echo -e "${YELLOW}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Update system
echo -e "${YELLOW}[1/7] Updating system packages...${NC}"
sudo yum update -y
echo -e "${GREEN}✓ System updated${NC}"
echo ""

# Install Node.js 18+
echo -e "${YELLOW}[2/7] Installing Node.js 18...${NC}"
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
node --version
npm --version
echo -e "${GREEN}✓ Node.js installed${NC}"
echo ""

# Install PM2
echo -e "${YELLOW}[3/7] Installing PM2...${NC}"
sudo npm install -g pm2
pm2 --version
echo -e "${GREEN}✓ PM2 installed${NC}"
echo ""

# Create application directory
echo -e "${YELLOW}[5/7] Creating application directory...${NC}"
sudo mkdir -p /opt/echolon-proxy
sudo chown ec2-user:ec2-user /opt/echolon-proxy
sudo mkdir -p /var/log/echolon-proxy
sudo chown ec2-user:ec2-user /var/log/echolon-proxy
echo -e "${GREEN}✓ Directories created${NC}"
echo ""

# Setup PM2 to start on boot
echo -e "${YELLOW}[6/7] Configuring PM2 startup...${NC}"
pm2 startup systemd -u ec2-user --hp /home/ec2-user
echo -e "${GREEN}✓ PM2 startup configured${NC}"
echo ""

# Nginx configuration hint
echo -e "${YELLOW}[7/7] Setup complete!${NC}"