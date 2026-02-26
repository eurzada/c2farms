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
    const role = await prisma.userFarmRole.findUnique({
      where: { user_id_farm_id: { user_id: req.userId, farm_id: farmId } },
    });

    if (!role) {
      return res.status(403).json({ error: 'Access denied: no access to this farm' });
    }

    req.farmRole = role.role;
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

// Farm-level role check — must be used AFTER requireFarmAccess (which sets req.farmRole)
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.farmRole || !allowedRoles.includes(req.farmRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
