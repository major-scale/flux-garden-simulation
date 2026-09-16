# Flux Garden: inspectable physical simulation

A browser-based physics and electronics playground with explicit models, numerical checks and inspectable energy accounting. Built to explore what makes AI-assisted engineering tools trustworthy: declared assumptions, useful diagnostics, reproducible experiments and honest limits.

## Run locally

Use Node.js **24 LTS** (or supported Node 22.12+).

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5311/ for mechanics. Other entry points:

| Page | Explore |
|---|---|
| `/electronics.html` | Circuit experiments |
| `/rc.html` | Resistor-capacitor behavior and visual explanations |
| `/lamp.html` | Electrical and thermal behavior |
| `/motor.html` | Electrical/mechanical coupling |
| `/controls.html` | Control circuits |
| `/sensors.html` | Sensor circuits |
| `/fan.html` | A composed fan example |
| `/bench.html` | Circuit composition bench |

These local demos need no AI provider key or paid service.

## Technical core

- TypeScript, Three.js and Rapier for interactive physical scenes.
- ngspice through eecircuit-engine for circuit simulation in a browser worker.
- Component contracts and composition validation before solver execution.
- Electrical, mechanical and lumped thermal models, numerical reference comparisons, checkpoint/replay and explicit energy accounting.
- Circuit conformance fixtures and negative controls; unsupported or invalid compositions produce diagnostics.
- Five Lean source files proving selected algebraic energy/coupling identities under explicit assumptions. They do **not** prove the complete numerical simulator or its physical accuracy.

## Checks

```sh
npm run build
npm run typecheck
npm test -- --maxWorkers=2
```

**The complete test suite intentionally retains two failing mechanics diagnostics**: a legacy coarse-step pendulum period and the fixed-assembly analytic trajectory. They document measured limits; this snapshot does not hide or weaken them to get a green badge. See [VALIDATION.md](VALIDATION.md) for the fresh publication run, and [mechanics notes](docs/MECHANICS-NOTES.md) / [deviations](docs/DEVIATIONS.md) for the original reasoning. Historical documents can refer to private planning files not included here.

A circuit-checking command is also included:

```sh
node tools/conform.mjs tools/conformance/fixtures/rc-step.composition.json tools/conformance/fixtures/rc-step.expectations.json --layout --out /tmp/flux-rc-report.json
```

Formal source is in `formal/`; the original proofs used Lean/Mathlib 4.31.0. Rechecking requires a compatible Mathlib project and is separate from npm tests. A machine-local Lean environment is not bundled.

## Boundaries

This is a research prototype, not an engineering certification tool. Mechanical constraints are not generally energy-conserving; unaccounted residuals are not relabeled as heat. Thermal models are lumped approximations, and coupled feedback has declared numerical limitations. Passing one fixture does not validate all assemblies, parameter regimes or physical devices.

## Project role and publication

Peter Murphy directed the project, requirements, architecture priorities and acceptance review. Implementation, numerical investigation and review used AI coding assistants. This is a curated snapshot of the newer simulation workspace, separate from the earlier private Flux Garden project. Provider infrastructure, keys and private coordination are excluded. See [publication notes](PUBLICATION.md) and [attribution](ATTRIBUTION.md).
