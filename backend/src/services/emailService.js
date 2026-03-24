import { Resend } from 'resend';
import createLogger from '../utils/logger.js';

const log = createLogger('email');

function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendPasswordResetEmail(email, resetUrl) {
  const resend = getClient();
  if (!resend) {
    log.warn('RESEND_API_KEY not configured — logging reset link to console');
    log.info(`Password reset link for ${email}: ${resetUrl}`);
    return;
  }

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM || 'C2 Farms <noreply@c2farms.com>',
    to: email,
    subject: 'C2 Farms — Password Reset',
    text: [
      'You requested a password reset.',
      '',
      'Click this link to reset your password:',
      resetUrl,
      '',
      'This link expires in 1 hour.',
      '',
      'If you did not request this, ignore this email.',
    ].join('\n'),
    html: [
      '<p>You requested a password reset.</p>',
      `<p><a href="${resetUrl}">Click here to reset your password</a></p>`,
      '<p>This link expires in 1 hour.</p>',
      '<p>If you did not request this, ignore this email.</p>',
    ].join('\n'),
  });

  if (error) {
    log.error('Failed to send password reset email', { email, error });
    throw new Error('Failed to send reset email');
  }

  log.info('Password reset email sent', { email });
}
