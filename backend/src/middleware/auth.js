import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Verify the authenticated user has a UserFarmRole for the requested farm
export async function requireFarmAccess(req, res, next) {
  const farmId = req.params.farmId;
  if (!farmId) return next();

  try {
    const [role, user] = await Promise.all([
      prisma.userFarmRole.findUnique({
        where: { user_id_farm_id: { user_id: req.userId, farm_id: farmId } },
      }),
      prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, name: true, email: true, role: true },
      }),
    ]);

    if (!role) {
      return res.status(403).json({ error: 'Access denied: no access to this farm' });
    }

    req.farmRole = role.role;
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// RBAC placeholder - currently allows all authenticated users
export function authorize(...roles) {
  return async (req, res, next) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (roles.length === 0) return next();

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Verify the authenticated user is admin on at least one farm
export async function requireAnyFarmAdmin(req, res, next) {
  try {
    const adminRoles = await prisma.userFarmRole.findMany({
      where: { user_id: req.userId, role: 'admin' },
      select: { farm_id: true },
    });

    if (adminRoles.length === 0) {
      return res.status(403).json({ error: 'Admin access required on at least one farm' });
    }

    req.adminFarmIds = adminRoles.map(r => r.farm_id);
    next();
  } catch (err) {
    next(err);
  }
}

// Module access check — must be used AFTER requireFarmAccess (which sets req.user)
// Checks that the user's global modules list includes the required module.
export function requireModule(module) {
  return async (req, res, next) => {
    const user = req.user || await prisma.user.findUnique({
      where: { id: req.userId },
      select: { modules: true },
    });
    const modules = user?.modules || ['forecast', 'inventory', 'marketing', 'logistics', 'agronomy', 'enterprise', 'terminal'];
    if (!modules.includes(module)) {
      return res.status(403).json({ error: `Access denied: ${module} module not enabled` });
    }
    next();
  };
}

// Farm-level role check — must be used AFTER requireFarmAccess (which sets req.farmRole)
// Admin implicitly has all permissions; manager includes viewer.
const ROLE_HIERARCHY = { admin: 3, manager: 2, viewer: 1 };

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.farmRole) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const userLevel = ROLE_HIERARCHY[req.farmRole] || 0;
    const minLevel = Math.min(...allowedRoles.map(r => ROLE_HIERARCHY[r] || 0));
    if (userLevel < minLevel) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
