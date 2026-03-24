import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { logActivity } from '../services/activityService.js';
import { sendPasswordResetEmail } from '../services/emailService.js';

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
      logActivity({ userId: user.id, action: 'login_failed', detail: 'Invalid password', req });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Auto-accept pending invites
    await acceptPendingInvites(user.id, trimmedEmail);

    logActivity({ userId: user.id, action: 'login', req });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// ── Forgot Password ──────────────────────────────────────────────
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    const genericMsg = 'If an account exists with that email, a reset link has been sent.';
    const trimmedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: trimmedEmail } });

    if (!user) {
      // Don't reveal whether email exists
      return res.json({ message: genericMsg });
    }

    // Invalidate any existing unused tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: { user_id: user.id, used_at: null },
      data: { used_at: new Date() },
    });

    // Generate token and store hashed version
    const token = crypto.randomBytes(32).toString('hex');
    const token_hash = await bcrypt.hash(token, 10);
    await prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token_hash,
        expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    const baseUrl = process.env.APP_URL || 'http://localhost:5173';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    await sendPasswordResetEmail(trimmedEmail, resetUrl);

    logActivity({ userId: user.id, action: 'password_reset_requested', req });
    res.json({ message: genericMsg });
  } catch (err) {
    next(err);
  }
});

// ── Reset Password ───────────────────────────────────────────────
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }
    if (typeof token !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Password policy (same as register)
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must contain at least one letter and one number' });
    }

    // Find valid (non-expired, non-used) tokens
    const candidates = await prisma.passwordResetToken.findMany({
      where: { used_at: null, expires_at: { gt: new Date() } },
    });

    let matched = null;
    for (const candidate of candidates) {
      const valid = await bcrypt.compare(token, candidate.token_hash);
      if (valid) { matched = candidate; break; }
    }

    if (!matched) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    // Update password and mark token used
    const password_hash = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: matched.user_id }, data: { password_hash } }),
      prisma.passwordResetToken.update({ where: { id: matched.id }, data: { used_at: new Date() } }),
    ]);

    logActivity({ userId: matched.user_id, action: 'password_reset_completed', req });
    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true, role: true, modules: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Also fetch user's farms
    const farmRoles = await prisma.userFarmRole.findMany({
      where: { user_id: req.userId },
      include: { farm: true },
    });

    res.json({ user, farms: farmRoles.map(fr => ({ ...fr.farm, role: fr.role, is_enterprise: fr.farm.is_enterprise || false, farm_type: fr.farm.farm_type || 'farm' })) });
  } catch (err) {
    next(err);
  }
});

export default router;
