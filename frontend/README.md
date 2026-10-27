# Task Planner Frontend

React + TypeScript (Vite) UI for the backend in `../backend`.

## Structure

```
src/
  api.ts          fetch wrapper for /api/v1/tasks
  types.ts        Task types (mirror backend schemas)
  components/     TaskForm, TaskItem
  App.tsx         page: create form, filters, task list
```

## Run

Start the backend first (see `../backend/README.md`), then:

```bash
npm install
npm run dev
```

Open http://localhost:3000. In dev, Vite proxies `/api` to `http://127.0.0.1:8000`
(override with `BACKEND_URL=http://host:port npm run dev`).

## Build

```bash
npm run build      # type-checks, outputs dist/
npm run preview
```

If the built app is served from a different origin than the API, set `VITE_API_URL`
(see `.env.example`) and add that origin to the backend's `CORS_ORIGINS`.
