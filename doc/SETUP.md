# Setup Guide

How to run the Task Planner (React frontend + FastAPI backend + MariaDB) in three ways,
with every command explained:

- [A. Manual setup (no Docker)](#a-manual-setup-no-docker): everything runs directly on the host. Best for development.
- [B. Docker, by hand](#b-docker-by-hand): every container, network and volume created with `docker` commands. Best for learning what Compose does for you.
- [C. Docker Compose](#c-docker-compose): the whole stack from `docker-compose.yml` with one command. The normal way to run it.

Contents:

1. [Architecture](#1-architecture)
2. [Prerequisites](#2-prerequisites)
3. [Configuration files](#3-configuration-files)
4. [A. Manual setup (no Docker)](#a-manual-setup-no-docker)
5. [B. Docker, by hand](#b-docker-by-hand)
6. [C. Docker Compose](#c-docker-compose)
7. [Accessing the app from your laptop](#7-accessing-the-app-from-your-laptop)
8. [Day-to-day operations](#8-day-to-day-operations)
9. [Troubleshooting](#9-troubleshooting)
10. [Security notes](#10-security-notes)

> Commands are shown without `sudo`. If your user is not in the `docker` group, prefix
> `docker ...` with `sudo`.

---

## 1. Architecture

### 1.1 Components

| Component | Technology | What it does |
| --- | --- | --- |
| **frontend** | React 19 + TypeScript, built with Vite | Single-page app in the browser. Talks to the backend over HTTP/JSON. |
| **lb** | nginx 1.28 | Load balancer / reverse proxy. Single entry point for the API; spreads requests over the backend replicas. |
| **backend** | FastAPI + Uvicorn, SQLAlchemy 2, PyMySQL | REST API at `/api/v1/tasks` plus `/health`. Stateless, so it can run as several replicas. |
| **db** | MariaDB 11.8 | Stores the `tasks` table. Data lives in the `db-data` volume. |

### 1.2 Docker architecture (options B and C)

```
              Your laptop browser
                     │
                     │  SSH tunnel (-L 8081, -L 8000), see section 7
                     ▼
 ┌──────────────────────── EC2 host ─────────────────────────────────────┐
 │                                                                       │
 │   host :8081                           host :8000                     │
 │      │                                    │                           │
 │ ┌────┼────────────── web-net (bridge) ────┼─────────────────────────┐ │
 │ │    ▼                                    ▼                         │ │
 │ │ ┌──────────┐                       ┌──────────┐                   │ │
 │ │ │ frontend │                       │    lb    │  nginx            │ │
 │ │ │  :8081   │                       │   :80    │  round robin      │ │
 │ │ └──────────┘                       └────┬─────┘                   │ │
 │ │  serves static JS/CSS                   │ DNS name "backend"      │ │
 │ │                               ┌─────────┴─────────┐               │ │
 │ │                               ▼                   ▼               │ │
 │ │                         ┌───────────┐       ┌───────────┐         │ │
 │ │                         │ backend-1 │       │ backend-2 │         │ │
 │ │                         │   :8000   │       │   :8000   │         │ │
 │ └─────────────────────────┴─────┬─────┴───────┴─────┬─────┴─────────┘ │
 │ ┌───────────────── db-net (internal: no outside access) ────────────┐ │
 │ │                               └─────────┬─────────┘               │ │
 │ │                                         ▼  DNS name "db"          │ │
 │ │                                   ┌───────────┐                   │ │
 │ │                                   │    db     │ MariaDB :3306     │ │
 │ │                                   └─────┬─────┘                   │ │
 │ └─────────────────────────────────────────┼─────────────────────────┘ │
 │                                           ▼                           │
 │                               volume: db-data (/var/lib/mysql)        │
 └───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Request flow

1. The browser opens `http://localhost:8081` and gets the HTML/JS/CSS from the **frontend** container.
2. The JavaScript calls `http://localhost:8000/api/v1/tasks`. That address was **baked into the
   bundle at build time** through `VITE_API_URL`.
3. Because the page (`:8081`) and the API (`:8000`) are different origins, the browser first sends a
   CORS check. The backend allows it because `CORS_ORIGINS` contains `http://localhost:8081`.
4. Port 8000 on the host goes to **lb** (nginx), which forwards the request to one of the
   **backend** replicas, taking turns (round robin).
5. The backend validates the request with Pydantic, runs SQL through SQLAlchemy and returns JSON.
6. The backend reaches MariaDB at hostname **`db`** over the internal **db-net** network.

### 1.4 Design decisions

| Decision | Why |
| --- | --- |
| **Two networks, `db-net` is `internal`** | The database is reachable *only* from the backend. An internal network has no route to the outside world and Docker will not publish ports on it, so the DB can never be exposed by accident. The frontend and lb are not on `db-net` at all. |
| **Backend joins both networks** | It must accept traffic from lb (`web-net`) and reach the DB (`db-net`). Being on `web-net` (a normal bridge) also makes port publishing work if you ever need it. |
| **Containers find each other by name, never `127.0.0.1`** | Inside a container `127.0.0.1` is the container itself. Docker's built-in DNS (`127.0.0.11`) resolves service names (`db`, `backend`) to container IPs on user-defined networks. |
| **Stateless backend + replicas** | All state is in MariaDB, so any replica can serve any request. Replicas give basic redundancy and let you scale with one number. |
| **nginx load balancer with `resolve`** | Two replicas share the DNS name `backend`. nginx looks the name up again every 10 s (`resolver ... valid=10s` + `server backend:8000 resolve`), so replicas that are added, removed or restarted (new IPs) are picked up without reloading nginx. |
| **Backend replicas publish no host ports** | Two containers cannot both bind host port 8000. Only lb is published; it is the single entry point. |
| **`VITE_API_URL` is a build argument** | Vite replaces `import.meta.env.VITE_API_URL` with a literal string during `npm run build`. Changing the API address means **rebuilding** the frontend image, not just restarting it. |
| **Separate env files per environment** | `backend/.env` (host run, DB at `127.0.0.1`) and `backend/.env.docker` (containers, DB at `db`) can never be mixed up. All real env files are gitignored. |
| **External `db-data` volume** | Compose will not delete it on `docker compose down -v`. The data outlives the stack and is shared by options B and C. |
| **Non-root containers** | The backend runs as `appuser`, the frontend as `node`. A compromised process has no root inside the container. |
| **DB healthcheck + `depends_on: service_healthy`** | The backend creates its tables at startup and exits if the DB is not ready. Compose waits until MariaDB reports healthy before starting the backend. |

### 1.5 Ports

| Port | Where | Used by |
| --- | --- | --- |
| 3000 | host | Vite dev server (option A) |
| 8000 | host | Option A: Uvicorn. Options B/C: nginx lb → backends |
| 8081 | host | Frontend container (`vite preview`) in options B/C |
| 3306 | host (A) / `db-net` only (B/C) | MariaDB |

### 1.6 Files involved

| File | Purpose | Committed? |
| --- | --- | --- |
| `docker-compose.yml` | Defines the whole stack for option C | yes |
| `nginx.conf` | lb config: upstream `backend` replicas | yes |
| `backend/Dockerfile` | Backend image | yes |
| `backend/.dockerignore` | Files left out of the backend build context | yes |
| `frontend/Dockerfile` | Frontend image | yes |
| `frontend/.dockerignore` | Files left out of the frontend build context | yes |
| `db.env` | MariaDB root/user passwords for the `db` container | **no** (gitignored) |
| `backend/.env` | Backend settings for option A | **no** (gitignored) |
| `backend/.env.docker` | Backend settings for options B/C | **no** (gitignored) |
| `backend/.env.example`, `frontend/.env.example` | Templates | yes |

---

## 2. Prerequisites

| Tool | Needed for | Check |
| --- | --- | --- |
| Python 3.12+ and `python3-venv` | Option A | `python3 --version` |
| Node.js 24 + npm | Option A (and building the frontend locally) | `node --version` |
| MariaDB server | Option A | `mariadb --version` |
| Docker Engine + Compose plugin | Options B and C | `docker --version`, `docker compose version` |

Install on Ubuntu:

```bash
# Option A
sudo apt-get update
sudo apt-get install -y python3-venv mariadb-server   # Debian/Ubuntu names the venv package python3.X-venv on some releases

# Options B/C: Docker Engine and the compose plugin, see https://docs.docker.com/engine/install/ubuntu/
sudo usermod -aG docker "$USER"   # optional: run docker without sudo (log out and back in afterwards)
```

---

## 3. Configuration files

All three are secret and gitignored. Create them once.

**Generate passwords** without characters that need escaping in URLs:

```bash
openssl rand -base64 24 | tr -d '/+='
```

- `openssl rand -base64 24` prints 24 random bytes as base64 text.
- `tr -d '/+='` deletes `/`, `+` and `=`. Those characters would need URL-encoding inside `DATABASE_URL`.

### 3.1 `db.env` (repo root, options B/C)

Read by the MariaDB container **only the first time it starts on an empty volume** (see
[Access denied](#access-denied-for-user-tasks)).

```dotenv
MARIADB_ROOT_PASSWORD=<root-password>
MARIADB_DATABASE=tasks
MARIADB_USER=tasks
MARIADB_PASSWORD=<app-password>
```

| Variable | Effect on first start |
| --- | --- |
| `MARIADB_ROOT_PASSWORD` | Password for the MariaDB `root` account. |
| `MARIADB_DATABASE` | Creates this database. |
| `MARIADB_USER` / `MARIADB_PASSWORD` | Creates this user and grants it all rights on `MARIADB_DATABASE` only. The backend uses this account. |

```bash
chmod 600 db.env   # readable by your user only
```

### 3.2 `backend/.env.docker` (options B/C)

```dotenv
ENVIRONMENT=development
DATABASE_URL=mysql+pymysql://tasks:<app-password>@db:3306/tasks?charset=utf8mb4
CORS_ORIGINS=["http://localhost:8081"]
```

| Variable | Meaning |
| --- | --- |
| `ENVIRONMENT` | `development` / `production` / `test`. `production` disables `/docs` and `/openapi.json`. |
| `DATABASE_URL` | `dialect+driver://user:password@host:port/database?options`. The host is **`db`**, the container's name on `db-net`. User, password and database must equal the values in `db.env`. |
| `CORS_ORIGINS` | JSON list of browser origins allowed to call the API. Must contain the address the frontend is opened from. |

If the password contains `@ : / ? # %` or similar, URL-encode it first:

```bash
python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' 'p@ss:word'
# p%40ss%3Aword
```

### 3.3 `backend/.env` (option A)

Same keys, but the DB runs on the host and the frontend dev server runs on port 3000:

```bash
cp backend/.env.example backend/.env
```

```dotenv
ENVIRONMENT=development
DATABASE_URL=mysql+pymysql://task_planner:<password>@127.0.0.1:3306/task_planner?charset=utf8mb4
CORS_ORIGINS=["http://localhost:3000"]
```

---

## A. Manual setup (no Docker)

Everything runs directly on the host. The frontend dev server proxies `/api` to the backend, so
there are no CORS concerns in this mode.

```
browser ──► Vite dev server :3000 ──(/api proxy)──► Uvicorn :8000 ──► MariaDB 127.0.0.1:3306
```

### A.1 Start MariaDB

```bash
sudo systemctl start mariadb
sudo systemctl enable mariadb      # optional
systemctl is-active mariadb
```

- `systemctl start mariadb` starts the MariaDB server now.
- `systemctl enable mariadb` starts it automatically at every boot.
- `systemctl is-active mariadb` prints `active` when it is running.

### A.2 Create the database and user

```bash
sudo mariadb <<'SQL'
CREATE DATABASE IF NOT EXISTS task_planner CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'task_planner'@'localhost' IDENTIFIED BY '<password>';
CREATE USER IF NOT EXISTS 'task_planner'@'127.0.0.1' IDENTIFIED BY '<password>';
GRANT ALL PRIVILEGES ON task_planner.* TO 'task_planner'@'localhost';
GRANT ALL PRIVILEGES ON task_planner.* TO 'task_planner'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

- `sudo mariadb` logs in as MariaDB `root` through the Unix socket. On Ubuntu, the OS root user needs no password for this.
- `CREATE DATABASE ... utf8mb4` creates the database with full Unicode support (including emoji).
- `CREATE USER` creates two accounts, because MariaDB treats `localhost` (socket) and `127.0.0.1` (TCP, which the backend uses) as different hosts.
- `GRANT ALL PRIVILEGES ON task_planner.*` gives the user rights on this one database only.
- `FLUSH PRIVILEGES` reloads the grant tables.

Check the login the same way the backend will connect:

```bash
mariadb -h 127.0.0.1 -u task_planner -p task_planner -e "SELECT 'ok'"
```

Then put the same password into `backend/.env` ([3.3](#33-backendenv-option-a)).

### A.3 Run the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
uvicorn app.main:app --reload
```

| Command | Explanation |
| --- | --- |
| `python3 -m venv .venv` | Creates an isolated Python environment in `backend/.venv`, so packages don't touch the system Python. |
| `source .venv/bin/activate` | Puts the venv's `python`/`pip`/`uvicorn` first on `PATH` for this shell. |
| `pip install -r requirements-dev.txt` | Installs the app dependencies (`requirements.txt`) plus test/lint tools. |
| `pytest` | Runs the test suite. It uses in-memory SQLite, so it does not need MariaDB. |
| `uvicorn app.main:app --reload` | Starts the ASGI server. `app.main:app` means "module `app/main.py`, variable `app`". `--reload` restarts on code changes (development only). Listens on `127.0.0.1:8000`. Tables are created on startup. |

Check: `curl localhost:8000/health` → `{"status":"ok"}`. API docs: http://localhost:8000/docs.

### A.4 Run the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

| Command | Explanation |
| --- | --- |
| `npm install` | Installs the packages from `package.json`, at the exact versions in `package-lock.json`, into `node_modules/`. |
| `npm run dev` | Starts the Vite dev server on port 3000 with hot reload. Requests to `/api/*` are proxied to `http://127.0.0.1:8000` (`vite.config.ts`). Set `BACKEND_URL` to proxy elsewhere. |

Open http://localhost:3000 (from your laptop, see [section 7](#7-accessing-the-app-from-your-laptop)).

---

## B. Docker, by hand

This builds exactly what `docker-compose.yml` defines, one command at a time. Run all commands from
the **repo root**.

> Run option B **or** option C, not both. They publish the same host ports and share the `db-data`
> volume. Stop the other one first (`docker compose down`, or the cleanup in [B.9](#b9-stop-and-clean-up)).

### B.1 Create the networks

```bash
docker network create web-net
docker network create --internal db-net
```

- `docker network create web-net` creates a user-defined **bridge** network. Containers on it can reach each other by name through Docker's DNS, and their ports can be published to the host.
- `--internal` makes `db-net` an isolated network: no route out of it, and Docker won't publish ports for containers attached only to it. Only containers attached to it can talk to the DB.

### B.2 Create the volume

```bash
docker volume create db-data
```

Creates a named volume managed by Docker (stored under `/var/lib/docker/volumes/db-data`). MariaDB
keeps its data files there, so the data survives removing or upgrading the container.

### B.3 Start the database

```bash
docker run -d --name db \
  --network db-net \
  --env-file db.env \
  -v db-data:/var/lib/mysql \
  --health-cmd "healthcheck.sh --connect --innodb_initialized" \
  --health-interval 5s --health-timeout 5s --health-retries 10 \
  --restart unless-stopped \
  mariadb:11.8
```

| Flag | Explanation |
| --- | --- |
| `-d` | Detached: run in the background and print the container ID. |
| `--name db` | Container name. Also its **DNS name** on the network, which is why the backend connects to host `db`. |
| `--network db-net` | Attach only to the internal network. Nothing outside Docker can reach the DB. |
| `--env-file db.env` | Load `MARIADB_*` variables. On an **empty** volume, the image's entrypoint uses them to create root, the database and the app user. |
| `-v db-data:/var/lib/mysql` | Mount the volume at MariaDB's data directory. |
| `--health-cmd ...` | Command Docker runs periodically to judge health. `healthcheck.sh` ships with the image. `--connect` checks that a client can connect; `--innodb_initialized` checks that the storage engine is ready. |
| `--health-interval/-timeout/-retries` | Run the check every 5 s, fail a check after 5 s, report `unhealthy` after 10 failures in a row. |
| `--restart unless-stopped` | Restart on crash and after a Docker/host restart, unless you stopped it yourself. |
| `mariadb:11.8` | Official image, pinned to a minor version so upgrades are deliberate. |

Wait until it is healthy:

```bash
docker ps --filter name=db --format '{{.Names}}  {{.Status}}'
# db  Up 20 seconds (healthy)
```

### B.4 Build the images

```bash
docker build -t tasks-backend:v1 ./backend
docker build -t tasks-frontend:v1 --build-arg VITE_API_URL=http://localhost:8000 ./frontend
```

- `docker build ./backend` uses `backend/` as the **build context** (the files sent to the builder) and `backend/Dockerfile` as the recipe.
- `-t tasks-backend:v1` tags the result as `name:version`.
- `--build-arg VITE_API_URL=...` sets the `ARG` in the frontend Dockerfile. This is the API address the **browser** will call, so it is built into the JavaScript.

What the Dockerfiles do:

**`backend/Dockerfile`**

| Line | Explanation |
| --- | --- |
| `FROM python:3.12-slim` | Small Debian image with Python. |
| `ENV PYTHONDONTWRITEBYTECODE=1` | Don't write `.pyc` files (no use in an immutable container). |
| `ENV PYTHONUNBUFFERED=1` | Print logs immediately, so `docker logs` is live. |
| `ENV PIP_NO_CACHE_DIR=1` | Don't keep pip's download cache, so the image is smaller. |
| `WORKDIR /app` | Working directory for the following instructions and at runtime. |
| `COPY requirements.txt .` then `RUN pip install ...` | Dependencies are installed **before** the code is copied. Docker caches each layer, so editing code doesn't reinstall packages. |
| `COPY app ./app` | Only the application package. Tests, `.venv` and `.env` stay out of the image. |
| `RUN useradd ... appuser` / `USER appuser` | Run as an unprivileged user. |
| `EXPOSE 8000` | Documents the port; it doesn't publish anything. |
| `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]` | `0.0.0.0` listens on every interface of the container. `127.0.0.1` would only accept connections from inside the container itself. |

**`frontend/Dockerfile`**

| Line | Explanation |
| --- | --- |
| `FROM node:24-alpine` | Small image with Node 24. |
| `RUN chown node:node /app` / `USER node` | Everything after this runs as the built-in `node` user, which owns `/app`. `vite preview` writes temp files into `node_modules/` at startup, so the files must belong to the user running it. |
| `COPY --chown=node:node package.json package-lock.json ./` then `RUN npm ci` | `npm ci` installs **exactly** what the lock file says (the frontend's equivalent of `pip install -r requirements.txt`). It runs before the source is copied, so this layer stays cached while only code changes. |
| `COPY --chown=node:node . .` | The source. `frontend/.dockerignore` keeps the host's `node_modules`, `dist` and `.env` out. |
| `ARG VITE_API_URL` / `ENV VITE_API_URL=$VITE_API_URL` / `RUN npm run build` | Type-check and bundle into `dist/`, with the API URL built in. |
| `CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "8081", "--strictPort"]` | Serve `dist/` on 8081. `--strictPort` fails instead of silently picking another port. |

### B.5 Start two backend replicas

```bash
for n in 1 2; do
  docker run -d --name backend-$n \
    --network name=web-net,alias=backend \
    --network db-net \
    --env-file backend/.env.docker \
    --restart unless-stopped \
    tasks-backend:v1
done
```

| Flag | Explanation |
| --- | --- |
| `for n in 1 2` | Start two identical containers, `backend-1` and `backend-2`. |
| `--network name=web-net,alias=backend` | Join `web-net` with the extra DNS name **`backend`**. Both replicas get the same alias, so a lookup of `backend` returns both IPs. That's what nginx balances over. |
| `--network db-net` | Also join the internal network to reach `db`. (Docker 25+ accepts several `--network` flags.) |
| `--env-file backend/.env.docker` | `DATABASE_URL` pointing at host `db`, and `CORS_ORIGINS` for `:8081`. |
| *(no `-p`)* | Replicas are only reachable through lb. |

Check that both connected to the DB:

```bash
docker logs backend-1 --tail 3     # ... Application startup complete.
docker logs backend-2 --tail 3
```

### B.6 Start the load balancer

```bash
docker run -d --name lb \
  --network web-net \
  -p 8000:80 \
  -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  --restart unless-stopped \
  nginx:1.28-alpine
```

| Flag | Explanation |
| --- | --- |
| `--network web-net` | Only the web network. lb never talks to the DB. |
| `-p 8000:80` | Publish: host port 8000 → container port 80. Format `HOST:CONTAINER`. Use `127.0.0.1:8000:80` to accept connections from the host only (see [security](#10-security-notes)). |
| `-v "$PWD/nginx.conf:...:ro"` | Bind-mount our config over nginx's default site, read-only. Bind mounts need an absolute path, hence `$PWD`. |

`nginx.conf` explained:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;    # Docker's embedded DNS. Re-resolve names every 10 s.

upstream backends {                          # a named pool of servers
    zone backends 64k;                       # shared memory, required for "resolve"
    server backend:8000 resolve;             # every IP behind the name "backend", kept up to date
}

server {
    listen 80;
    location / {
        proxy_pass http://backends;                                   # round robin over the pool
        proxy_set_header Host $host;                                  # keep the original Host header
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # pass on the client IP
        add_header X-Served-By $upstream_addr always;                 # debug: which replica answered
    }
}
```

### B.7 Start the frontend

```bash
docker run -d --name frontend \
  --network web-net \
  --init \
  -p 8081:8081 \
  --restart unless-stopped \
  tasks-frontend:v1
```

- `--init` runs a tiny init process as PID 1. It forwards signals and reaps zombie processes, so `docker stop` shuts Node down cleanly instead of waiting 10 s and killing it.
- `-p 8081:8081` publishes the frontend.
- `--network web-net` isn't strictly needed, because the browser (not the container) calls the API, but it keeps all web-facing containers together.

### B.8 Verify

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl localhost:8000/health                               # {"status":"ok"}
for i in 1 2 3 4; do curl -s -D - -o /dev/null localhost:8000/health | grep -i x-served-by; done
                                                          # alternates between the two replica IPs
curl -s localhost:8081/ | grep -o '<title>.*</title>'    # <title>Task Planner</title>
```

### B.9 Stop and clean up

```bash
docker rm -f frontend lb backend-1 backend-2 db
docker network rm web-net db-net
# docker volume rm db-data     # ONLY if you want to delete all data
```

- `docker rm -f` stops (force) and removes the containers. The volume and the data stay.
- `docker network rm` removes the networks. This only works once no container is attached.
- `docker volume rm db-data` permanently deletes the database files.

---

## C. Docker Compose

Compose reads `docker-compose.yml` and creates everything from section B for you: networks,
containers, replicas, start order and healthchecks.

### C.1 First run

```bash
docker volume create db-data      # once: the volume is declared "external"
docker compose up -d --build
docker compose ps
```

| Command | Explanation |
| --- | --- |
| `docker volume create db-data` | The compose file marks `db-data` as `external: true`, so Compose uses it but never creates or deletes it. Create it once. |
| `docker compose up` | Create and start every service, in dependency order. |
| `-d` | Detached: return to the shell. Without it, logs from every container stream in the terminal. |
| `--build` | Rebuild images that have a `build:` section (backend, frontend) before starting. Use it after code changes. |
| `docker compose ps` | Lists this project's containers with status and ports. |

Compose names things `<project>-<service>-<n>` and `<project>_<network>`. With `name: tasks`
you get `tasks-backend-1`, `tasks_db-net` and so on. Inside the networks, the **service name**
(`db`, `backend`) is the DNS name.

### C.2 `docker-compose.yml` explained

```yaml
name: tasks                        # project name, used as the prefix for containers/networks
```

**`db`**

```yaml
  db:
    image: mariadb:11.8            # = docker run ... mariadb:11.8
    env_file: db.env               # = --env-file db.env
    volumes:
      - db-data:/var/lib/mysql     # = -v db-data:/var/lib/mysql
    networks: [db-net]             # internal network only
    healthcheck:                   # = --health-cmd/--health-interval/...
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped
```

**`backend`**

```yaml
  backend:
    build: ./backend               # build from backend/Dockerfile ...
    image: tasks-backend:v1        # ... and tag the result with this name
    env_file: backend/.env.docker  # DB host "db" + CORS for :8081 (NOT backend/.env)
    networks: [web-net, db-net]    # reachable by lb, can reach db
    deploy:
      replicas: 2                  # two containers; both answer to DNS name "backend"
    depends_on:
      db:
        condition: service_healthy # start only after db's healthcheck passes
    restart: unless-stopped
```

There's no `ports:` and no `container_name:`. Both would clash between replicas.

**`lb`**

```yaml
  lb:
    image: nginx:1.28-alpine
    ports:
      - "8000:80"                  # = -p 8000:80
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro   # relative paths are allowed here
    networks: [web-net]
    depends_on: [backend]          # start after the backend containers are created
    restart: unless-stopped
```

**`frontend`**

```yaml
  frontend:
    build:
      context: ./frontend
      args:
        VITE_API_URL: http://localhost:8000   # = --build-arg; the URL the browser calls
    image: tasks-frontend:v1
    init: true                     # = --init
    ports:
      - "8081:8081"
    networks: [web-net]
    restart: unless-stopped
```

**Networks and volumes**

```yaml
networks:
  web-net: {}                      # default bridge network
  db-net:
    internal: true                 # = docker network create --internal

volumes:
  db-data:
    external: true                 # created outside Compose; never removed by it
```

### C.3 Everyday Compose commands

| Command | Explanation |
| --- | --- |
| `docker compose ps` | Status of all services. |
| `docker compose logs -f backend` | Follow the logs of every backend replica (`-f` = follow, Ctrl+C to stop). |
| `docker compose logs --tail 50 db` | Last 50 lines from the DB. |
| `docker compose up -d --build backend` | Rebuild and recreate only the backend after a code change. |
| `docker compose up -d --build frontend` | Same for the frontend. **Needed whenever `VITE_API_URL` changes.** |
| `docker compose up -d --scale backend=3` | Run 3 replicas. nginx picks the new one up within 10 s. |
| `docker compose restart lb` | Restart a service without recreating it (e.g. after editing `nginx.conf`). |
| `docker compose up -d` | Apply edits to `docker-compose.yml` or env files. Only changed services are recreated. |
| `docker compose exec db sh` | Open a shell inside the running `db` container. |
| `docker compose stop` | Stop everything, keep the containers. |
| `docker compose down` | Stop and remove the containers and networks. `db-data` is kept. |
| `docker compose config` | Print the final config after merging and variable substitution. Useful for spotting typos. |

---

## 7. Accessing the app from your laptop

The servers run on the EC2 instance. Forward their ports over SSH instead of opening them in the
security group:

```bash
# Options B/C: page on 8081, API on 8000 (the browser calls both)
ssh -i /path/to/key.pem -L 8081:localhost:8081 -L 8000:localhost:8000 ubuntu@<EC2_PUBLIC_IP>

# Option A: only the Vite dev server (it proxies /api itself); add 8000 for /docs
ssh -i /path/to/key.pem -L 3000:localhost:3000 -L 8000:localhost:8000 ubuntu@<EC2_PUBLIC_IP>
```

- `-L 8081:localhost:8081` means "connections to port 8081 on my laptop go through the SSH session to `localhost:8081` on the instance".
- Keep the SSH session open while you use the app.

Then open http://localhost:8081 (B/C) or http://localhost:3000 (A).

With VS Code Remote-SSH, add the ports in the **Ports** panel instead.

---

## 8. Day-to-day operations

**Open a SQL shell**

```bash
docker compose exec db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'
```

The single quotes make `$MARIADB_*` expand **inside the container**, where `db.env` set them, so the
password never appears on your command line.

**Back up and restore**

```bash
docker compose exec -T db sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' > backup.sql
docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"' < backup.sql
```

`-T` disables the pseudo-terminal. That's needed when you redirect stdin/stdout with `>` or `<`.

**Check load balancing**

```bash
for i in $(seq 10); do curl -s -D - -o /dev/null localhost:8000/health | grep -i x-served-by; done | sort | uniq -c
```

**Health check from the shell:** `curl localhost:8000/health` → `{"status":"ok"}`.

---

## 9. Troubleshooting

### Frontend shows "Request failed (502)"

The proxy in front of the backend (Vite in option A, nginx in B/C) got no answer.

- Option A: the backend isn't running. Start `uvicorn` ([A.3](#a3-run-the-backend)).
- B/C: `docker compose ps`. Are the backend containers `Up` or `Restarting`? Check `docker compose logs backend`.

### `Can't connect to MySQL server on '127.0.0.1' ([Errno 111] Connection refused)`

The backend container got the **host** settings (`backend/.env`). Inside a container `127.0.0.1`
is the container itself. Use `backend/.env.docker` with host **`db`** (`env_file:` in Compose,
`--env-file` with `docker run`).

### `Access denied for user 'tasks'@...`

MariaDB applies `db.env` **only when the volume is empty**. If `db-data` was created earlier with
other credentials, changing `db.env` has no effect.

Check from inside the container:

```bash
docker compose exec db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" -e "select current_user()"'
```

If that fails too, either:

- **Start fresh** (deletes all data): `docker compose down`, `docker volume rm db-data`, `docker volume create db-data`, `docker compose up -d`.
- **Keep the data, reset the passwords:**

  ```bash
  docker compose stop backend db
  docker run -d --name db-reset -v db-data:/var/lib/mysql mariadb:11.8 --skip-grant-tables --skip-networking
  docker exec -it db-reset mariadb -uroot
  ```

  `--skip-grant-tables` turns off password checks; `--skip-networking` makes sure nobody can connect
  over the network meanwhile. Then, in the SQL prompt, with the values from `db.env`:

  ```sql
  FLUSH PRIVILEGES;
  ALTER USER 'root'@'localhost' IDENTIFIED BY '<root-password>';
  ALTER USER 'root'@'%'         IDENTIFIED BY '<root-password>';
  CREATE DATABASE IF NOT EXISTS tasks CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS 'tasks'@'%' IDENTIFIED BY '<app-password>';
  ALTER USER 'tasks'@'%' IDENTIFIED BY '<app-password>';
  GRANT ALL PRIVILEGES ON tasks.* TO 'tasks'@'%';
  FLUSH PRIVILEGES;
  ```

  Exit, then `docker rm -f db-reset` and `docker compose up -d`.

  `FLUSH PRIVILEGES` must come first: it reloads the grant tables, and `ALTER USER` doesn't work
  without them. Skip the `root'@'%'` line if that account doesn't exist.

### `-p` is ignored / port not reachable

A container attached **only** to an `internal` network gets no published ports, and Docker doesn't
warn you. Attach it to a normal network too (the backend is on `web-net` for this reason).

### Frontend container restarts with `EACCES: permission denied ... node_modules/.vite-temp`

The files are owned by root but the process runs as `node`. The Dockerfile must `chown /app` and
switch to `USER node` **before** `npm ci`, and copy with `--chown=node:node`. It does this now;
rebuild with `docker compose up -d --build frontend`.

### Browser console: "blocked by CORS policy"

The page's origin isn't in `CORS_ORIGINS`. Add it, e.g. `["http://localhost:8081"]`, in
`backend/.env.docker`, then `docker compose up -d backend`.

### Frontend calls the wrong API address

`VITE_API_URL` is fixed at build time. Change the build arg and rebuild:
`docker compose up -d --build frontend`.

### All requests hit one replica

Right after replicas are recreated, nginx may still hold the old DNS answer. Wait about 10 s and test
again. Check `docker compose exec lb nslookup backend 127.0.0.11`, which should list one IP per replica.

### Files show up in the image that shouldn't (e.g. `.env`, `.venv`)

Docker only reads a file named exactly **`.dockerignore`** (with the leading dot) in the build context.

---

## 10. Security notes

- **Bind published ports to localhost** when you only use the SSH tunnel: `"127.0.0.1:8000:80"` and
  `"127.0.0.1:8081:8081"`. Otherwise anyone the security group lets in can use the API and write
  to the database. There's no login.
- **Never commit** `db.env`, `backend/.env` or `backend/.env.docker`. They're covered by `.gitignore`.
- The DB is only on the internal `db-net`, and the app user can only access its own database.
- For anything public, set `ENVIRONMENT=production` (hides `/docs`), put TLS in front of nginx, and
  add authentication.
