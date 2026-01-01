#!/usr/bin/env bash
set -euo pipefail

BUCKET="${BUCKET:-}"
AWS_PROFILE="${AWS_PROFILE:-modrena}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}"

echo "--------------------------------"
echo "Bucket: $BUCKET"
echo "Profile: $AWS_PROFILE"
if [ -n "$DISTRIBUTION_ID" ]; then
  echo "Distribution: $DISTRIBUTION_ID"
fi
echo "--------------------------------"

# Validation
if [ -z "$BUCKET" ]; then
  echo "❌ BUCKET is not set. Check your .env.production file."
  exit 1
fi

# Ensure dist exists
if [ ! -d "dist" ]; then
  echo "❌ dist/ directory not found. Run 'npm run build' first."
  exit 1
fi

# 1) Gzip HTML/CSS/JS in-place (deterministic)
find dist -type f \( -name "*.html" -o -name "*.css" -o -name "*.js" \) -print0 |
  xargs -0 -n1 -P8 bash -c '
    f="$0"
    gzip -n -9 -c "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  '
echo "✅ Gzipped HTML/CSS/JS deterministically."

# 2) Non-HTML/CSS/JS assets (images, fonts, videos) — skip if size unchanged
aws s3 sync dist/ "s3://$BUCKET" --delete --exclude "*.html" --exclude "*.css" --exclude "*.js" \
  --exclude ".DS_Store" --exclude "*/.DS_Store" --cache-control "public,max-age=31536000,immutable" --size-only --profile "$AWS_PROFILE"

echo "✅ Uploaded non-HTML/CSS/JS assets."

# 3) JS & CSS (already gzipped) — skip if size unchanged
aws s3 sync dist/ "s3://$BUCKET" --delete --exclude "*" --include "*.js" --include "*.css" --content-encoding gzip \
  --cache-control "public,max-age=31536000,immutable" --size-only --profile "$AWS_PROFILE"

echo "✅ Uploaded JS & CSS assets."

# 4) HTML (already gzipped) — short cache, skip if size unchanged
aws s3 sync dist/ "s3://$BUCKET" --delete --exclude "*" --include "*.html" --content-encoding gzip \
  --cache-control "public,max-age=60" --size-only --profile "$AWS_PROFILE"

echo "✅ Uploaded HTML assets."

echo ""
echo "✅ Successfully deployed to AWS S3"
echo "🚀 Preview: http://$BUCKET.s3-website.eu-central-1.amazonaws.com"

# 5) CloudFront invalidation (only if DISTRIBUTION_ID is set)
if [ -n "$DISTRIBUTION_ID" ]; then
  echo ""
  echo "🔄 Invalidating CloudFront cache..."
  aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" --profile "$AWS_PROFILE"
  echo "✅ CloudFront cache invalidated"
fi

