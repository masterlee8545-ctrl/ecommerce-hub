#!/usr/bin/env node
/**
 * PostToolUse hook: lint .ts/.tsx files immediately after Edit/Write.
 * Injects ESLint errors back into Claude's context so it self-corrects.
 *
 * stdin: { tool_name, tool_input: { file_path }, tool_response: { filePath } }
 * stdout: JSON with hookSpecificOutput.additionalContext on failure
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

const PROJECT_ROOT = 'C:/개발/ecommerce-hub';

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

const filePath =
  (input.tool_input && input.tool_input.file_path) ||
  (input.tool_response && input.tool_response.filePath) ||
  '';

// Only lint TypeScript files
if (!/\.(ts|tsx)$/.test(filePath)) {
  process.exit(0);
}

// Skip node_modules, .next, generated files
if (/node_modules|\.next|drizzle\/meta/.test(filePath)) {
  process.exit(0);
}

// Verify file still exists (might have been a delete)
try {
  fs.accessSync(filePath, fs.constants.R_OK);
} catch {
  process.exit(0);
}

try {
  execSync(`npx eslint --max-warnings 0 "${filePath}"`, {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    timeout: 30000,
  });
  // ESLint passed — silent success
} catch (e) {
  const stdout = e.stdout ? e.stdout.toString().slice(-1500) : '';
  const stderr = e.stderr ? e.stderr.toString().slice(-500) : '';
  const errorOutput = (stdout + '\n' + stderr).trim();

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: [
          `[HOOK] ESLint FAILED on: ${filePath}`,
          errorOutput,
          'Fix these lint errors before moving on.',
        ].join('\n'),
      },
    })
  );
}
