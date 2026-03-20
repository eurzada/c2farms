import prisma from '../config/database.js';

/**
 * Extract client IP from request, handling proxies (Render uses X-Forwarded-For).
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For can be comma-separated; first is the real client
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || null;
}

/**
 * Log an activity. Failures are swallowed so logging never breaks the main operation.
 */
export async function logActivity({ userId, action, detail, req, metadata }) {
  try {
    await prisma.activityLog.create({
      data: {
        user_id: userId,
        action,
        detail: detail || null,
        ip_address: req ? getClientIp(req) : null,
        user_agent: req?.headers?.['user-agent']?.substring(0, 500) || null,
        metadata: metadata ?? undefined,
      },
    });
  } catch (err) {
    console.error('Activity log failed:', err.message);
  }
}

/**
 * Query activity logs with filters.
 */
export async function queryActivity({ userId, ipAddress, action, since, until, limit = 100, offset = 0 }) {
  const where = {};

  if (userId) where.user_id = userId;
  if (ipAddress) where.ip_address = ipAddress;
  if (action) where.action = action;
  if (since || until) {
    where.created_at = {};
    if (since) where.created_at.gte = new Date(since);
    if (until) where.created_at.lte = new Date(until);
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return { logs, total };
}

/**
 * Get activity summary grouped by user and IP for a date range.
 */
export async function activitySummary({ since, until }) {
  const where = {};
  if (since || until) {
    where.created_at = {};
    if (since) where.created_at.gte = new Date(since);
    if (until) where.created_at.lte = new Date(until);
  }

  const logs = await prisma.activityLog.findMany({
    where,
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { created_at: 'desc' },
  });

  // Group by user
  const byUser = {};
  for (const log of logs) {
    const key = log.user_id;
    if (!byUser[key]) {
      byUser[key] = {
        user: log.user,
        ips: new Set(),
        actions: {},
        first_seen: log.created_at,
        last_seen: log.created_at,
        total: 0,
      };
    }
    const entry = byUser[key];
    if (log.ip_address) entry.ips.add(log.ip_address);
    entry.actions[log.action] = (entry.actions[log.action] || 0) + 1;
    if (log.created_at < entry.first_seen) entry.first_seen = log.created_at;
    if (log.created_at > entry.last_seen) entry.last_seen = log.created_at;
    entry.total++;
  }

  // Convert Sets to arrays for JSON serialization
  return Object.values(byUser).map(entry => ({
    ...entry,
    ips: [...entry.ips],
  }));
}
