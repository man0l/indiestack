#!/usr/bin/env node
// Writes the content-hashed admin asset URLs into src/kernel/assets.ts so the
// Worker shell references immutable files (no stale-overwrite races, no cache
// issues). Run after `vite build`. If dist is absent and no refs file exists
// yet, writes stable-name placeholders so `tsc` still passes.
import { existsSync, readdirSync, writeFileSync } from "node:fs";

const dir = "dist/admin/_app";
const out = "src/kernel/assets.ts";
let js = "/_app/admin.js";
let css = "/_app/admin.css";
if (existsSync(dir)) {
  const files = readdirSync(dir);
  const j = files.find((f) => /^admin\.[A-Za-z0-9_-]+\.js$/.test(f));
  const c = files.find((f) => /^admin\.[A-Za-z0-9_-]+\.css$/.test(f));
  if (j) js = `/_app/${j}`;
  if (c) css = `/_app/${c}`;
  writeFileSync(out, `export const ADMIN_JS = ${JSON.stringify(js)};\nexport const ADMIN_CSS = ${JSON.stringify(css)};\n`);
  console.log(`asset refs: ${js} ${css}`);
} else if (!existsSync(out)) {
  writeFileSync(out, `export const ADMIN_JS = ${JSON.stringify(js)};\nexport const ADMIN_CSS = ${JSON.stringify(css)};\n`);
  console.log(`no dist; wrote placeholder refs`);
} else {
  console.log(`no dist; kept existing refs`);
}
