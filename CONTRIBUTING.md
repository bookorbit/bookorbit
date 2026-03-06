# Contributing

## Daily Workflow

Use this command surface:

1. `pnpm setup` (once per machine)
2. `pnpm dev` (daily coding loop)
3. `pnpm verify` (before push)

Optional:

1. `pnpm quick` (faster checks while coding)
2. `pnpm verify:strict` (aspirational strict gate while we burn down baseline debt)
3. `pnpm guide` (show command reference)

## Quality Gates

Before opening or updating a PR:

1. `pnpm verify` must pass
2. `pnpm verify:strict` is currently optional until formatting and full client typecheck baseline debt is reduced.
3. If tests touched critical flows, run `pnpm test:e2e:smoke`
4. If coverage-sensitive changes are made, run `pnpm coverage`

## Check vs Fix Commands

Non-mutating:

1. `pnpm format:check`
2. `pnpm lint:check`
3. `pnpm typecheck`
4. `pnpm typecheck:full`
5. `pnpm typecheck:client:baseline:update` (update accepted client TS baseline after intentional changes)

Mutating:

1. `pnpm format`
2. `pnpm lint:fix`

## Database Commands

1. `pnpm db:up`
2. `pnpm db:migrate`
3. `pnpm db:seed`
4. `pnpm db:reset`

## Troubleshooting

1. Run `pnpm doctor` for environment checks.
2. If dependencies changed, run `pnpm install`.
3. If local DB state is inconsistent, run `pnpm db:reset`.
