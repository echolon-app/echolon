import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User, Subscription } from '../models';
import { generateToken, authMiddleware } from '../middleware/auth';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimit';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email';
import { passport } from '../services/oauth';

const router = Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Helper to get typed user from request
const getUser = (req: Request): User => req.user as unknown as User;

// Register with email/password
router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password must be at least 8 characters',
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'An account with this email already exists',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate email verification token
    const emailVerificationToken = uuidv4();
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create user
    const user = await User.create({
      email: email.toLowerCase(),
      passwordHash,
      name: name || null,
      emailVerificationToken,
      emailVerificationExpires,
    });

    // Create default personal subscription
    await Subscription.create({
      userId: user.id,
      plan: 'personal',
      status: 'active',
    });

    // Send verification email
    await sendVerificationEmail(user.email, emailVerificationToken, user.name || undefined);

    // Generate JWT token
    const token = generateToken(user);

    res.status(201).json({
      message: 'Account created successfully. Please check your email to verify your account.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
      },
      token,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Login with email/password
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
      });
    }

    // Find user
    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user || !user.passwordHash) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Generate JWT token
    const token = generateToken(user);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Verify email
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Token is required',
      });
    }

    const user = await User.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid or expired verification token',
      });
    }

    if (user.emailVerificationExpires && user.emailVerificationExpires < new Date()) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Verification token has expired. Please request a new one.',
      });
    }

    // Update user
    await user.update({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    });

    res.json({
      message: 'Email verified successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: true,
      },
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Resend verification email
router.post('/resend-verification', authLimiter, authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = getUser(req);

    if (user.emailVerified) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email is already verified',
      });
    }

    // Generate new verification token
    const emailVerificationToken = uuidv4();
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await user.update({
      emailVerificationToken,
      emailVerificationExpires,
    });

    await sendVerificationEmail(user.email, emailVerificationToken, user.name || undefined);

    res.json({
      message: 'Verification email sent',
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Request password reset
router.post('/forgot-password', passwordResetLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email is required',
      });
    }

    // Always return success to prevent email enumeration
    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    
    if (user && user.passwordHash) {
      // Only allow password reset for users who registered with email/password
      const passwordResetToken = uuidv4();
      const passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await user.update({
        passwordResetToken,
        passwordResetExpires,
      });

      await sendPasswordResetEmail(user.email, passwordResetToken, user.name || undefined);
    }

    res.json({
      message: 'If an account exists with this email, you will receive a password reset link.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Reset password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Token and password are required',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password must be at least 8 characters',
      });
    }

    const user = await User.findOne({
      where: { passwordResetToken: token },
    });

    if (!user) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid or expired reset token',
      });
    }

    if (user.passwordResetExpires && user.passwordResetExpires < new Date()) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Reset token has expired. Please request a new one.',
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Update user
    await user.update({
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
    });

    res.json({
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = getUser(req);

    // Get subscription
    const subscription = await Subscription.findOne({
      where: { userId: user.id },
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
        oauthProvider: user.oauthProvider,
        createdAt: user.createdAt,
      },
      subscription: subscription ? {
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      } : null,
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update profile
router.patch('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const { name, avatarUrl } = req.body;

    const updates: Partial<{ name: string; avatarUrl: string }> = {};
    if (name !== undefined) updates.name = name;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

    await user.update(updates);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Change password
router.post('/change-password', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Current password and new password are required',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'New password must be at least 8 characters',
      });
    }

    if (!user.passwordHash) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot change password for OAuth accounts',
      });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Current password is incorrect',
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await user.update({ passwordHash });

    res.json({
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============== OAuth Routes ==============

// Google OAuth
router.get('/oauth/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false,
}));

router.get('/oauth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${FRONTEND_URL}/login?error=oauth_failed` }),
  (req: Request, res: Response) => {
    const user = req.user as User;
    const token = generateToken(user);
    // Redirect to frontend with token
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`);
  }
);

// GitHub OAuth
router.get('/oauth/github', passport.authenticate('github', {
  scope: ['user:email'],
  session: false,
}));

router.get('/oauth/github/callback',
  passport.authenticate('github', { session: false, failureRedirect: `${FRONTEND_URL}/login?error=oauth_failed` }),
  (req: Request, res: Response) => {
    const user = req.user as User;
    const token = generateToken(user);
    // Redirect to frontend with token
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`);
  }
);

export default router;

