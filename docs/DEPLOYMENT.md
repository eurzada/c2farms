# Deployment

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | 256-bit secret for JWT signing. Generate: `openssl rand -base64 32` |
| `PORT` | No | `3001` | Backend server port |
| `NODE_ENV` | Production | — | Set to `production` |
| `CORS_ORIGIN` | Production | `true` (all origins) | Comma-separated allowed origins |
| `QB_CLIENT_ID` | For QB | — | QuickBooks OAuth client ID |
| `QB_CLIENT_SECRET` | For QB | — | QuickBooks OAuth client secret |
| `QB_REDIRECT_URI` | For QB | — | QuickBooks OAuth redirect URI |
| `QB_ENVIRONMENT` | For QB | `sandbox` | `sandbox` or `production` |
| `QB_TOKEN_ENCRYPTION_KEY` | For QB | — | AES-256 key for token encryption |
| `FRONTEND_URL` | No | — | Frontend URL for QB callback redirect |

## Development Setup

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### Database

```bash
docker compose up -d
```

This starts PostgreSQL 16 on port 5432 with:
- User: `c2farms`
- Password: `c2farms_dev`
- Database: `c2farms`

Data persists in a Docker volume (`pgdata`).

### Backend

```bash
cd backend
npm install
npx prisma db push --schema=src/prisma/schema.prisma
npm run db:seed
npm run dev    # starts on :3001 with --watch
```

### Frontend

```bash
cd frontend
npm install
npm run dev    # starts Vite on :5173
```

Vite proxies `/api` and `/socket.io` requests to `localhost:3001`.

### Prisma Studio

```bash
cd backend
npm run db:studio    # opens GUI on :5555
```

## Production Build

### 1. Build the frontend

```bash
cd frontend
npm run build    # outputs to frontend/dist/
```

### 2. Start the backend

```bash
cd backend
NODE_ENV=production node src/server.js
```

The backend serves the frontend static files from `frontend/dist/` and handles SPA routing (all non-`/api` routes serve `index.html`).

Only one process/port is needed in production.

## VPS Deployment (Self-Hosted)

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name c2farms.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name c2farms.example.com;

    ssl_certificate /etc/letsencrypt/live/c2farms.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/c2farms.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The `Upgrade` and `Connection` headers are required for Socket.io WebSocket connections.

### SSL Certificate

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d c2farms.example.com
```

### Process Management (PM2)

```bash
npm install -g pm2

cd backend
pm2 start src/server.js --name c2farms
pm2 save
pm2 startup    # auto-start on reboot
```

### PostgreSQL Security

- Listen on `localhost` only (not `0.0.0.0`)
- Use a strong password (20+ chars)
- Enable SSL: append `?sslmode=require` to `DATABASE_URL`
- Restrict to the application server's IP if on a separate host

### Firewall

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (redirect to HTTPS)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable
```

## Managed Platform Deployment

Platforms like Render, Railway, or Fly.io:

1. Set all environment variables in the platform dashboard
2. Build command: `cd frontend && npm run build && cd ../backend && npm install`
3. Start command: `cd backend && npx prisma db push --schema=src/prisma/schema.prisma && node src/server.js`
4. Use the platform's managed PostgreSQL addon
5. Enable auto-deploy from the `main` branch

### Health Check

The app provides a health endpoint at `GET /api/health`:

```json
{ "status": "ok", "timestamp": "2026-02-28T12:00:00.000Z" }
```

Configure the platform to poll this endpoint.

## Tunneling (Remote Demos)

For quick remote access during development, use Cloudflare Tunnel (free, no account needed):

```bash
# Install cloudflared
curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
chmod +x /tmp/cloudflared

# Tunnel to the Vite dev server (proxies both frontend and API)
/tmp/cloudflared tunnel --url http://localhost:5173
```

Only one tunnel is needed — Vite proxies `/api` and `/socket.io` to the backend.

Vite is configured with `allowedHosts: 'all'` to accept any tunnel domain.

> **Note**: ngrok's free plan only supports 1 tunnel, which is why cloudflared is preferred.

## Database Backups

### Manual backup

```bash
pg_dump -U c2farms -h localhost c2farms > backup_$(date +%Y%m%d).sql
```

### Restore

```bash
psql -U c2farms -h localhost c2farms < backup_20260228.sql
```

### In-app backup

Admins can export all farm data as JSON via Settings → Backup (`POST /api/farms/:farmId/settings/backup`).

## Security Checklist

See [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) for a complete pre-production security audit covering:

- JWT secret management
- CORS lockdown
- Database credential rotation
- Rate limiting (already implemented)
- Security headers (Helmet, already implemented)
- TLS/HTTPS enforcement
- Input validation
- Audit logging
- Dependency scanning
