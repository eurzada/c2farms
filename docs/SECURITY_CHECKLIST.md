# C2 Farms Security Checklist

## Executive Summary

C2 Farms is a farm financial management application handling sensitive budget data, QuickBooks integrations, and multi-user access. This document outlines the security measures required before production deployment, categorized by priority. Each item includes remediation steps for both VPS (self-hosted) and managed platform deployments.

**Current Status**: Development. The items below must be addressed before handling real farm financial data.

---

## CRITICAL Priority

These must be resolved before any production deployment.

### 1. JWT Secret Management
**Risk**: The default JWT secret can be guessed, allowing token forgery.

**Remediation**:
- Generate a 256-bit (32-byte) random secret: `openssl rand -base64 32`
- Store in environment variable `JWT_SECRET` — never commit to source control
- Rotate annually or immediately if compromised

### 2. QuickBooks API Token Encryption at Rest
**Risk**: QB OAuth tokens stored in plaintext in the database could be exfiltrated.

**Remediation**:
- Encrypt `access_token` and `refresh_token` with AES-256-GCM before storing
- Store encryption key in `QB_TOKEN_ENCRYPTION_KEY` environment variable
- Decrypt only at point of use in `quickbooksService.js`

### 3. CORS Lockdown
**Risk**: `origin: true` in CORS config allows any origin to make authenticated requests.

**Remediation**:
- Set `CORS_ORIGIN` environment variable to your production domain(s)
- Update `app.js`: `cors({ origin: process.env.CORS_ORIGIN?.split(','), credentials: true })`
- For development, keep `origin: true` only in `.env.development`

### 4. Database Credentials
**Risk**: Default development credentials are well-known.

**Remediation**:
- Generate a strong password (20+ chars, mixed case, numbers, symbols)
- Update `DATABASE_URL` in production environment
- Restrict PostgreSQL network access to application server only
- Enable SSL connections: append `?sslmode=require` to connection string

---

## HIGH Priority

Address these before handling real user data.

### 5. Rate Limiting on Auth Endpoints ✅ IMPLEMENTED
**Status**: `express-rate-limit` is installed and applied in `app.js`. Global rate limit is configured. Auth-specific tighter limits should still be considered.

### 6. Security Headers (Helmet.js) ✅ IMPLEMENTED
**Status**: `helmet` is installed and applied in `app.js` (`helmet({ contentSecurityPolicy: false })`).

### 7. TLS/HTTPS Enforcement
**Risk**: Credentials and tokens transmitted in plaintext.

**Remediation**:
- **VPS**: Use certbot with nginx reverse proxy for Let's Encrypt SSL
- **Managed platform**: Enable platform-provided SSL (Render, Railway, etc.)
- Set `Strict-Transport-Security` header via helmet
- Redirect all HTTP to HTTPS

### 8. Input Validation
**Risk**: Malformed input could cause unexpected behavior or injection.

**Remediation**:
- Install `zod` or `joi` for schema validation
- Validate all POST/PATCH request bodies at the route handler level
- Sanitize string inputs (trim whitespace, limit length)
- Validate email format on auth endpoints

### 9. Password Policy
**Risk**: Weak passwords are easily compromised.

**Remediation**:
- Enforce minimum 8 characters on registration
- Add validation in `/api/auth/register` before hashing
- Consider requiring at least one number and one letter

### 10. Automated Database Backups
**Risk**: Data loss from hardware failure, accidental deletion, or corruption.

**Remediation**:
- **VPS**: Daily `pg_dump` via cron, upload to S3/GCS with 30-day retention
- **Managed platform**: Enable provider's automated backup feature
- Test restore procedure quarterly

---

## MEDIUM Priority

Recommended for production maturity.

### 11. Audit Logging
**Purpose**: Track who changed what, when, and from where.

**Remediation**:
- Log all write operations with user ID, farm ID, timestamp, and IP
- Store in a separate `audit_logs` table or external logging service
- Include: budget edits, freeze/unfreeze, user management, role changes

### 12. Dependency Scanning
**Purpose**: Catch known vulnerabilities in npm packages.

**Remediation**:
- Run `npm audit` in CI pipeline, fail on high/critical
- Enable Dependabot or Snyk for automated PR-based updates
- Review and update dependencies monthly

### 13. Socket.io Rate Limiting
**Risk**: Malicious clients could flood real-time events.

**Remediation**:
- Limit events per connection (e.g., 100 events/minute)
- Disconnect clients that exceed the threshold
- Validate all incoming socket event payloads

### 14. Shorter JWT Expiry + Refresh Tokens
**Risk**: Long-lived tokens (currently 7 days) increase exposure window if stolen.

**Remediation**:
- Reduce access token expiry to 15-60 minutes
- Implement refresh token rotation (stored in httpOnly cookie)
- Add `/api/auth/refresh` endpoint

### 15. Structured Error Logging — PARTIALLY IMPLEMENTED
**Status**: Custom structured logger exists at `backend/src/utils/logger.js`. Outputs JSON in production, human-readable in dev. Currently used by `csvImport.js`; adoption across all routes is still in progress.

**Remaining work**:
- Adopt `createLogger()` in all route files and services (replace remaining `console.log`)
- Consider log aggregation for production (CloudWatch, Datadog, etc.)

---

## VPS Deployment Checklist

- [ ] Firewall: Allow only ports 22 (SSH), 80, 443
- [ ] nginx reverse proxy with SSL termination
- [ ] Let's Encrypt SSL certificate (certbot)
- [ ] PM2 or systemd for Node.js process management
- [ ] All environment variables set in `/etc/environment` or PM2 ecosystem file
- [ ] PostgreSQL listening on localhost only (not 0.0.0.0)
- [ ] SSH key-only authentication (disable password auth)
- [ ] Unattended security updates enabled
- [ ] Log rotation configured

## Managed Platform Checklist

- [ ] All environment variables set in platform dashboard
- [ ] Managed database with automated backups
- [ ] Auto-deploy from `main` branch with CI checks
- [ ] Custom domain with platform-provided SSL
- [ ] Health check endpoint configured (`/api/health`)
- [ ] Monitoring/alerting enabled

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | 256-bit secret for JWT signing |
| `PORT` | No | Server port (default: 3001) |
| `CORS_ORIGIN` | Production | Comma-separated allowed origins |
| `QB_CLIENT_ID` | For QB | QuickBooks OAuth client ID |
| `QB_CLIENT_SECRET` | For QB | QuickBooks OAuth client secret |
| `QB_REDIRECT_URI` | For QB | QuickBooks OAuth redirect URI |
| `QB_TOKEN_ENCRYPTION_KEY` | For QB | AES-256 key for token encryption |
| `FRONTEND_URL` | No | Frontend URL for QB callback redirect |
| `NODE_ENV` | Production | Set to `production` |

---

## Incident Response

1. **Credential Exposure**: Rotate JWT_SECRET and QB secrets immediately. Force logout all users. Review git history for committed secrets.
2. **Database Breach**: Change all database passwords. Audit access logs. Notify affected users. Review and revoke QB tokens.
3. **Unauthorized Access**: Disable compromised user accounts. Review audit logs for scope of access. Reset affected passwords.
4. **Dependency Vulnerability**: Run `npm audit fix`. If no fix available, evaluate alternative packages or apply workarounds.

---

*Last reviewed: 2026-02-25*
*Next review due: Before production deployment*
