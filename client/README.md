# ProjectX - Client

Vue 3 SPA built with Vite and Tailwind CSS v4.

## Running

From the repo root: `pnpm dev` (starts both server and client).

Client only: `pnpm dev` (from this directory). Runs at http://localhost:5173.

The Vite dev server proxies `/api` and `/socket.io` requests to the backend at `localhost:3000`.

## IDE setup

- **VS Code:** Install the [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) extension. Disable Vetur if installed.
- **WebStorm / IntelliJ:** Vue support is built in. Enable TypeScript service for `.vue` files.
- **Browser:** Install [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd) and enable Custom Object Formatters in DevTools settings.

## Project layout

```
src/
├── features/           Feature modules (one folder per domain)
│   ├── auth/           Login, registration, password reset
│   ├── book/           Book detail, covers, metadata
│   ├── library/        Library management
│   ├── collection/     Book collections
│   ├── lens/           Saved search views
│   ├── scanner/        Scan progress UI
│   ├── reader/         Book reader (epub, pdf, cbz)
│   ├── settings/       User settings
│   └── admin/          Admin panel (users, roles, settings)
├── components/         Shared components (header, sidebar, icons)
│   └── ui/             Reusable UI primitives (button, dialog, etc.)
├── composables/        Global composables
├── views/              Route-level page components
├── router/             Vue Router config and guards
├── lib/                Utilities (api client, helpers)
├── stores/             Pinia stores (theme only - prefer composables)
└── assets/             CSS, fonts, static assets
```

## Testing

```bash
pnpm test:unit          # run unit tests
pnpm test:cov           # run unit tests with coverage
```

## Key conventions

- All components use `<script setup lang="ts">` (Composition API only).
- Feature state lives in composables (`features/<name>/composables/use*.ts`), not global stores.
- HTTP calls use the native `fetch` API via `src/lib/api.ts`.
- Styling with Tailwind CSS v4 utility classes. Theme tokens are CSS variables in `src/assets/main.css`.
- Icons from `lucide-vue-next` only.
- Shared types imported from `@projectx/types`.
