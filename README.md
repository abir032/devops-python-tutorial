# Task Planner

A small task manager used as a DevOps tutorial project: a React frontend, a FastAPI backend and
MariaDB, runnable directly on a host, with plain Docker or with Docker Compose.

```
browser ──► frontend (React) ──► lb (nginx) ──► backend ×2 (FastAPI) ──► db (MariaDB)
```

## Repository layout

| Path | Contents |
| --- | --- |
| [`backend/`](backend/README.md) | FastAPI REST API (`/api/v1/tasks`), SQLAlchemy models, tests, Dockerfile |
| [`frontend/`](frontend/README.md) | React + TypeScript (Vite) single-page app, Dockerfile |
| `docker-compose.yml` | Full stack: db, 2 backend replicas, nginx load balancer, frontend |
| `nginx.conf` | Load balancer config |
| [`doc/`](doc/SETUP.md) | Documentation |

## Quick start (Docker Compose)

```bash
# 1. create db.env and backend/.env.docker (see the setup guide, section 3)
docker volume create db-data
docker compose up -d --build
```

Open http://localhost:8081 (from a remote server, use an SSH tunnel).

## Documentation

**[Setup Guide](doc/SETUP.md)** covers:

- Architecture: components, networks, request flow and design decisions
- Manual setup without Docker
- Running every container by hand with `docker` commands
- Docker Compose, with the compose file explained line by line
- Operations (logs, scaling, backups) and troubleshooting
