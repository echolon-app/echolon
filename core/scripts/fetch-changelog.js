#!/usr/bin/env node
/**
 * Fetch changelog for current version from landing page JSON
 * and format it for GitHub release notes
 * Outputs to a file that can be used by electron-builder or GitHub CLI
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const coreDir = join(__dirname, '..');

// Get version from package.json
const packageJson = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf-8'));
const version = packageJson.version;

if (!version) {
  console.error('❌ Could not find version in package.json');
  process.exit(1);
}

// Read changelog from local file (in core directory)
const changelogPath = process.env.CHANGELOG_PATH || 
  join(coreDir, 'changelog.json');

async function fetchChangelog() {
  try {
    let changelog;
    
    // Read from local file
    if (!existsSync(changelogPath)) {
      throw new Error(`Changelog file not found at: ${changelogPath}`);
    }
    
    const content = await readFile(changelogPath, 'utf-8');
    changelog = JSON.parse(content);
    
    console.log(`📖 Reading changelog from: ${changelogPath}`);
    
    // Find entry for current version
    const entry = changelog.find((e) => e.version === version);
    
    if (!entry) {
      console.warn(`⚠️  No changelog entry found for version ${version}`);
      return null;
    }
    
    // Format as markdown for GitHub release notes
    const lines = [];
    
    // Add highlights if present
    if (entry.highlights && entry.highlights.length > 0) {
      lines.push('## Highlights');
      entry.highlights.forEach((highlight) => {
        lines.push(`- ${highlight}`);
      });
      lines.push('');
    }
    
    // Add changes by category
    if (entry.changes && entry.changes.length > 0) {
      const categoryLabels = {
        added: '✨ Added',
        improved: '🚀 Improved',
        fixed: '🐛 Fixed',
        removed: '🗑️ Removed',
        security: '🔒 Security',
      };
      
      entry.changes.forEach((change) => {
        const label = categoryLabels[change.category] || change.category;
        lines.push(`### ${label}`);
        change.items.forEach((item) => {
          lines.push(`- ${item}`);
        });
        lines.push('');
      });
    }
    
    const releaseNotes = lines.join('\n').trim();
    
    if (!releaseNotes) {
      console.warn(`⚠️  Changelog entry for ${version} is empty`);
      return null;
    }
    
    // Write to file for electron-builder or GitHub CLI
    const releaseNotesPath = join(coreDir, 'release-notes.txt');
    writeFileSync(releaseNotesPath, releaseNotes, 'utf-8');
    
    // Also output to stdout
    console.log(releaseNotes);
    
    // Set as environment variable
    process.env.RELEASE_NOTES = releaseNotes;
    
    console.log(`✅ Release notes written to ${releaseNotesPath}`);
    
    return releaseNotes;
  } catch (error) {
    console.error(`❌ Error fetching changelog: ${error.message}`);
    return null;
  }
}

fetchChangelog().then((notes) => {
  if (!notes) {
    // Don't exit with error - just warn, release can continue without notes
    process.exit(0);
  }
});
