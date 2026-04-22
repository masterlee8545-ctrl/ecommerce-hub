#!/usr/bin/env node
/**
 * Stop hook: enforce `npm run gc` (lint + typecheck + test + build) before
 * Claude can finish a session. Blocks the stop if gc fails.
 *
 * stdout: JSON with decision:"block" on failure
 */
'use strict';

const { execSync } = require('child_process');

const PROJECT_ROOT = 'C:/개발/ecommerce-hub';

try {
  execSync('npm run gc', {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    timeout: 300000, // 5 minutes — build can be slow
  });
  // gc passed — allow stop
  process.exit(0);
} catch (e) {
  const stdout = e.stdout ? e.stdout.toString() : '';
  const stderr = e.stderr ? e.stderr.toString() : '';
  const combined = (stdout + '\n' + stderr).trim();

  // Extract last 2000 chars to keep output manageable
  const tail = combined.slice(-2000);

  console.log(
    JSON.stringify({
      decision: 'block',
      reason: [
        '[GC GATE FAILED] lint + typecheck + test + build did not pass.',
        'Fix ALL errors below before reporting completion:',
        '---',
        tail,
      ].join('\n'),
    })
  );
}
