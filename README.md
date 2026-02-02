# Caimera Quiz Backend

Node.js + Express + Redis + BullMQ + MongoDB backend for the competitive math quiz.

## Features

- SSE stream for live updates (`/stream`)
- Concurrency-safe winner selection (Redis sorted set + atomic lock)
- Grace window + late-submit tolerance for fairness
- Intermission phase with winner display
- Prefetched next question to remove post-break delay
- Leaderboard in Redis + user wins in MongoDB

## Setup

```bash
pnpm install
cp .env.example .env
```

Required env:
- `REDIS_URL` (or host/port/username/password fields)
- `MONGO_URI`
- `PORT` (default 4000)

Optional env:
- `GRACE_MS` (default 250)
- `INTERMISSION_MS` (default 5000)
- `LATE_MS` (default 0)
- `RABBIT_URL` (optional)

## Run

```bash
pnpm run dev
pnpm run worker
```

Or run both:

```bash
pnpm run dev:all
```

## API Endpoints

- `GET /health`
- `GET /question`
- `POST /submit`
- `POST /users/register`
- `GET /leaderboard`
- `GET /stream` (SSE)

## Key Files

- `server.ts` — API + SSE + submit handling
- `worker.ts` — question generation + winner finalization
- `questions.ts` — question generator

