# Task Planner API

FastAPI + MariaDB backend (SQLAlchemy 2).

## Structure

```
app/
  api/        routers (v1/) and dependencies
  core/       settings
  db/         engine/session and declarative base
  models/     SQLAlchemy models
  schemas/    Pydantic request/response models
  services/   business logic (no HTTP concerns)
tests/        pytest suite (in-memory SQLite)
```

## Run

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # point DATABASE_URL at a running MariaDB
uvicorn app.main:app --reload
```

Tables are created on startup. Docs: http://localhost:8000/docs

## Endpoints (`/api/v1`)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/tasks` | Create task |
| GET | `/tasks` | List tasks (`status`, `priority`, `skip`, `limit`) |
| GET | `/tasks/{id}` | Get task |
| PATCH | `/tasks/{id}` | Partial update |
| DELETE | `/tasks/{id}` | Delete task |

## Quality

```bash
pytest
ruff check . && ruff format --check .
```
