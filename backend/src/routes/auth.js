import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Accept any pending farm invites for a user
async function acceptPendingInvites(userId, email) {
  const pendingInvites = await prisma.farmInvite.findMany({
    where: { email, status: 'pending', expires_at: { gt: new Date() } },
  });

  for (const invite of pendingInvites) {
    // Create farm role if it doesn't already exist
    await prisma.userFarmRole.upsert({
      where: { user_id_farm_id: { user_id: userId, farm_id: invite.farm_id } },
      update: {},
      create: { user_id: userId, farm_id: invite.farm_id, role: invite.role },
    });

    await prisma.farmInvite.update({
      where: { id: invite.id },
      data: { status: 'accepted' },
    });
  }

  return pendingInvites.length;
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password, and name are required' });
    }

    if (typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string') {
      return res.status(400).json({ error: 'email, password, and name must be strings' });
    }

    if (email.length > 254 || name.length > 100 || password.length > 128) {
      return res.status(400).json({ error: 'Input exceeds maximum length' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    if (trimmedName.length < 1) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Password policy: min 8 chars, at least one letter and one number
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must contain at least one letter and one number' });
    }

    const existing = await prisma.user.findUnique({ where: { email: trimmedEmail } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email: trimmedEmail, password_hash, name: trimmedName },
      select: { id: true, email: true, name: true, role: true },
    });

    // Auto-accept pending invites
    await acceptPendingInvites(user.id, trimmedEmail);

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'email and password must be strings' });
    }

    if (email.length > 254 || password.length > 128) {
      return res.status(400).json({ error: 'Input exceeds maximum length' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email: trimmedEmail } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Auto-accept pending invites
    await acceptPendingInvites(user.id, trimmedEmail);

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Also fetch user's farms
    const farmRoles = await prisma.userFarmRole.findMany({
      where: { user_id: req.userId },
      include: { farm: true },
    });

    res.json({ user, farms: farmRoles.map(fr => ({ ...fr.farm, role: fr.role })) });
  } catch (err) {
    next(err);
  }
});

export default router;
