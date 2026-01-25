#!/usr/bin/env node
/**
 * Update GitHub release notes after electron-builder creates the release
 * This script reads release-notes.txt and updates the GitHub release
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const coreDir = join(__dirname, '..');

// Get version from package.json
const packageJson = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf-8'));
const version = packageJson.version;
const releaseTag = `v${version}`;

// Check if release notes file exists
const releaseNotesPath = join(coreDir, 'release-notes.txt');

if (!existsSync(releaseNotesPath)) {
  console.log('⚠️  No release notes file found, skipping update');
  process.exit(0);
}

const releaseNotes = readFileSync(releaseNotesPath, 'utf-8').trim();

if (!releaseNotes) {
  console.log('⚠️  Release notes file is empty, skipping update');
  process.exit(0);
}

// Check if GitHub CLI is available
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

try {
  // Check if gh CLI is available
  execSync('which gh', { stdio: 'ignore' });
  
  console.log(`📝 Updating release notes for ${releaseTag}...`);
  
  // Update release using GitHub CLI
  // Write notes to temp file for gh command
  const tempNotesPath = join(coreDir, '.release-notes-temp.txt');
  writeFileSync(tempNotesPath, releaseNotes, 'utf-8');
  
  try {
    execSync(`gh release edit ${releaseTag} --notes-file ${tempNotesPath}`, {
      stdio: 'inherit',
      env: process.env,
    });
    console.log(`✅ Successfully updated release notes for ${releaseTag}`);
    
    // Clean up temp file
    unlinkSync(tempNotesPath);
  } catch (error) {
    console.error(`❌ Failed to update release notes: ${error.message}`);
    // Clean up temp file
    try {
      unlinkSync(tempNotesPath);
    } catch {}
    process.exit(1);
  }
} catch (error) {
  console.warn('⚠️  GitHub CLI (gh) not found. Release notes update skipped.');
  console.warn('   Install GitHub CLI: https://cli.github.com/');
  console.warn('   Or manually update the release at:');
  console.warn(`   https://github.com/echolon-app/echolon/releases/tag/${releaseTag}`);
  console.log('\nRelease notes:');
  console.log(releaseNotes);
  process.exit(0);
}
