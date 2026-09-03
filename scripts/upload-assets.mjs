#!/usr/bin/env node
// Upload built admin assets to R2 with correct content types.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const dir = 'dist/admin/_app';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' };

for (const f of readdirSync(dir)) {
  if (!statSync(join(dir, f)).isFile()) continue;
  const ext = f.slice(f.lastIndexOf('.'));
  const type = types[ext] ?? 'application/octet-stream';
  execSync(`npx wrangler r2 object put indiestack/assets/${f} --file=${join(dir, f)} --content-type='${type}' --remote`, { stdio: 'inherit' });
}
