# Changelog

## 0.1.2 — 2026-10-30

- Pin MoonBit 0.10.18 and enforce the contest minimum of 0.10.16.
- Publish as `cjyhjy/contextguard` with a root `guard_request` API and standalone example. This replaces the unpublished development import `contextguard/guard/src`; Node API calls are unchanged.
- Add six public API tests on all three supported backends. Test the actual source archive in an independent consumer.
- Restrict the Mooncakes archive to source, tests, example and license. Keep CLI/demo/evaluation in GitHub and the portable ZIP.
- Consolidate reproducible setup and contest acceptance evidence.

## 0.1.1

Strict rg byte ranges and duplicate JSON key validation, process/transport errors, short-output protection, demo request snapshots and immutable delivery packaging. See `docs/OPTIMIZATION.md`.
