# Publication validation - 2026-09-16

Fresh checks in the clean publication copy (Node 23.10.0 on macOS):

- `npm ci`: completed. Vitest reports that Node 23 is outside its supported range; use Node 24 LTS (or supported Node 22.12+) for normal development.
- `npm run build`: PASS (TypeScript check plus Vite build for nine HTML entry points). Large bundle warnings remain; the circuit worker includes its solver.
- `npm test -- --maxWorkers=2`: **847 pass, 2 fail, 849 total**, 60 test files.

The failures are the two existing retained mechanics diagnostics:

1. `mechanics.test.ts`, legacy M=4 pendulum period: 90-degree relative error 0.0407122 vs a 0.01 limit.
2. `connections.test.ts`, fixed-assembly trajectory: position error 0.00837807 m vs a 0.005 m limit.

No acceptance thresholds or numerical implementation were changed for this release. Detailed historical limitations are in docs/MECHANICS-NOTES.md and docs/DEVIATIONS.md. Lean sources and browser interactions were not freshly revalidated in this publication pass.

The published files are selected runtime source, tests, fixtures, build configuration, formal source and technical documentation. Private agent coordination, provider raw responses, paid-run tooling and historical Git data are excluded. The verification script's default absolute Lean-workspace path is replaced with the local formal directory; FLUX_LEAN_DIR remains the way to provide a configured Mathlib workspace. Tests and demo execution require no model API credentials.
