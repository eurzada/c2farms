# Development Process — Seeing Changes Take Effect

## One command to run everything

From the **project root**:

```bash
npm run dev
```

This starts both backend and frontend in one terminal. You'll see output from both (backend in blue, frontend in green). Keep this terminal open.

**First time:** run `npm install` from the root so `concurrently` is available.

## How changes apply

| What you change | What happens | When you see it |
|-----------------|--------------|-----------------|
| Backend files (`backend/src/*.js`) | Node `--watch` restarts the server | A few seconds after save |
| Frontend files (`frontend/src/*`) | Vite HMR hot-reloads | Immediately in browser (often without full refresh) |
| Prisma schema (`backend/src/prisma/schema.prisma`) | Schema changes need `npx prisma db push` + server restart | After you run `cd backend && npx prisma db push` and the server restarts |

## If changes aren't showing up

1. **Is `npm run dev` running?** Check the terminal — you should see "Server running on port 3001" (backend) and "Local: http://localhost:5173/" (frontend). If not, start it: `npm run dev` from the project root.

2. **Save the file.** Cursor auto-saves, but if it's off, press Ctrl+S (or Cmd+S). Watchers only react to saved files.

3. **Hard refresh the browser.** For frontend changes, try Ctrl+Shift+R (Cmd+Shift+R on Mac) to bypass cache.

4. **Check the terminal for errors.** A syntax error or crash can stop the backend from restarting; fix the error and save again.

5. **PostgreSQL running?** The backend needs the database: `docker compose up -d` from the project root.

## Alternative: run servers separately

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

Both use file watching; no manual restarts needed for code changes.
