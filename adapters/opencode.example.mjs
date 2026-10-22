// Optional local loader. This file is NOT installed or automatically activated.
// Import this module from a project-level .opencode/plugins/contextguard.mjs.
// Adjust the import path if you copy this file into a different directory.
import { createContextGuardPlugin } from './opencode.mjs';

export const ContextGuard = createContextGuardPlugin({
  maxOutputChars: 12000,
  evidenceDirectory: '.contextguard/evidence',
  allowCommands: [
    {
      command: 'node --test --test-reporter=tap fixtures/sources/many-tests.test.cjs',
      scope: ['fixtures/sources/many-tests.test.cjs'],
      workdir: '.',
    },
    {
      command: 'rg --json --context 1 needle fixtures/sources/search',
      scope: ['fixtures/sources/search'],
      workdir: '.',
    },
  ],
});
