#!/usr/bin/env node
import { guardJson } from './api.mjs';
import { readRequest } from './input.mjs';
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('ContextGuard JSON CLI\nnode tools/cli.mjs [request.json]\nReads one JSON request from file or stdin. See docs/API.md.');
  } else {
    if (args.length > 1) throw new Error('expected at most one request file');
    const source = readRequest(args[0] ?? 0);
    console.log(JSON.stringify(guardJson(source)));
  }
} catch (error) {
  console.error(JSON.stringify({error: error.message}));
  process.exitCode = 2;
}
