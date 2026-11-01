# Modular development

New business functionality belongs in a feature module under `src/modules/`.
Use a modular monolith with explicit public contracts, not shared mutable state
or imports of another feature's private implementation.

- `domain/`: pure rules and models, independent of React, Tauri and stores.
- `application/`: use cases and dependency ports.
- `infrastructure/`: concrete platform/storage/transport adapters.
- `ui/`: presentation and local view state.
- `index.ts` and explicitly declared additional entry points: public API.
- `module.json`: allowed entry points and dependencies.

Do not create empty layers merely to satisfy this layout. The application
composition root wires executors, adapters and cross-feature workflows.
Modules own their data and migrations. Local and Web clients reuse business
contracts and select different platform adapters.

Before submitting a change:

```sh
npm run check:modules
npm run audit:modules:check
npm run typecheck
# Run the module tests and any affected integration checks.
```

The boundary checker is part of CI and also checks server adapters against feature public APIs. It rejects private cross-module imports,
undeclared dependencies, UI/platform coupling in domain code, non-literal module
imports and module dependency cycles. It currently governs the new modules tree;
legacy code is being migrated, with explicit compatibility entry points.

Eighteen modules now contain extracted implementation: star-map, memory, domains,
tasks, quality, wiki, ingestion, retrieval, cli, research, projects, documents, agent, obsidian, settings, service-api, platform and identity. See the
[migration status](analysis/architecture/migration-progress.md) for the exact scope
and remaining legacy orchestration.
The complete module inventory, dependency rules, storage ownership and migration
sequence are in [the architecture design](analysis/architecture/modular-design-v1.md).

Task completion must update [TASKS](TASKS.md), append implementation and validation
in [WORKLOG](WORKLOG.md), and refresh the next step in [HANDOFF](HANDOFF.md).
Start a new session by reading those files and checking the actual Git state.

B16 audits production callers across the source tree as well as feature manifests.
The reproducible [boundary audit](analysis/architecture/module-boundary-audit.md)
and [JSON inventory](analysis/architecture/module-audit-v1.json) document the exact
scope. After changing source-file inventory, imports or public contracts, regenerate
with `npm run audit:modules` and commit the report; CI checks its consistency.

The desktop independent mode and the standalone shared-service/Web mode are
explicitly separate deployments. See [C01 deployment boundaries](analysis/architecture/deployment-and-offline.md)
and [shared service operations](analysis/implementation/shared-service.md).
The service requires Node.js 24; runtime data and service keys are never committed.

The [identity permission matrix](analysis/architecture/identity-permission-matrix.md)
defines account kinds, project membership ceilings and granted work roles. C04 stores
this catalog internally; authentication and HTTP authorization remain C05–C09.

C05–C10 now authenticate personnel sessions and scoped Agent Tokens, capture
credential-bound immutable contexts, and authorize shared resource/execution ports.
The identity UI and transport-injected SDK are reusable; the Web composition root
selects them. [Server authorization](analysis/architecture/server-authorization.md)
and [operations](analysis/implementation/shared-service.md) describe current scope.
The bootstrap key does not grant data access. SQLite schema 7 adds persistent audit;
actual shared task/native execution engines remain subsequent H/I work.
