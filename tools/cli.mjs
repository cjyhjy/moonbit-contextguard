#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { guard } from './api.mjs';
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('ContextGuard JSON CLI\nnode tools/cli.mjs [request.json]\nReads one JSON request from file or stdin. See docs/API.md.');
  } else {
    if (args.length > 1) throw new Error('expected at most one request file');
    const source = readFileSync(args[0] ?? 0, 'utf8');
    if (source.length > 8388608) throw new Error('request_budget_exceeded');
    console.log(JSON.stringify(guard(JSON.parse(source))));
  }
} catch (error) {
  console.error(JSON.stringify({error: error.message}));
  process.exitCode = 2;
}
