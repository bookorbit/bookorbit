# Production Deployment (Docker Compose)

This project's production Compose stack is intentionally separate from local development.

## 1) Configure production environment

Create `.env.prod` from the example and set real values:

```bash
cp .env.prod.example .env.prod
```

Required fields:

- `APP_IMAGE` (immutable tag or digest from CI, for example `ghcr.io/<owner>/<repo>:sha-<commit>`)
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `JWT_SECRET`
- `APP_URL`

## 2) Deploy

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --wait
```

What happens:

- `postgres` starts with `pgvector` enabled via init SQL.
- `migrate` runs once (`node dist/scripts/migrate.js`) and must complete successfully.
- `app` starts only after DB health is `healthy` and migration service exits successfully.

## 3) Roll forward

1. Update `APP_IMAGE` in `.env.prod` to the new immutable image.
2. Pull + restart:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --wait
```

## 4) Backup strategy

Create a compressed custom-format Postgres backup:

```bash
pnpm db:backup:prod
```

By default this writes to `local/backups/`.

Recommended cadence:

- Daily backups
- Keep at least 7 daily + 4 weekly + 3 monthly snapshots
- Store a copy off-host

## 5) Restore strategy

Restore into the live DB:

```bash
pnpm db:restore:prod -- local/backups/<file>.dump
```

Run a non-destructive restore test into a temporary DB:

```bash
pnpm db:restore:test:prod -- local/backups/<file>.dump
```

Run the restore test at least monthly so backup integrity is continuously verified.

## 6) CI image pipeline

Workflow: `.github/workflows/container-image.yml`

On `main` and tag pushes it:

- builds the Docker image
- pushes immutable tags to GHCR (`sha-*`)
- scans the image with Trivy (high/critical)
- generates an SPDX SBOM artifact
