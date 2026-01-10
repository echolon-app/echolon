import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  } : undefined,
});

const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@echolon.app';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const LANDING_URL = process.env.LANDING_URL || 'http://localhost:4321';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  // In development, just log the email
  if (process.env.NODE_ENV === 'development') {
    console.log('📧 Email would be sent:');
    console.log(`  To: ${options.to}`);
    console.log(`  Subject: ${options.subject}`);
    console.log(`  Body: ${options.text || options.html.substring(0, 200)}...`);
    return true;
  }

  try {
    const command = new SendEmailCommand({
      Source: EMAIL_FROM,
      Destination: {
        ToAddresses: [options.to],
      },
      Message: {
        Subject: {
          Data: options.subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: options.html,
            Charset: 'UTF-8',
          },
          ...(options.text && {
            Text: {
              Data: options.text,
              Charset: 'UTF-8',
            },
          }),
        },
      },
    });

    await sesClient.send(command);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
};

export const sendVerificationEmail = async (
  email: string,
  token: string,
  name?: string
): Promise<boolean> => {
  const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;
  const greeting = name ? `Hi ${name}` : 'Hi';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background: #22c55e; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Verify your email</h1>
        <p>${greeting},</p>
        <p>Thanks for signing up for Echolon! Please verify your email address by clicking the button below:</p>
        <p style="margin: 30px 0;">
          <a href="${verifyUrl}" class="button">Verify Email</a>
        </p>
        <p>Or copy and paste this URL into your browser:</p>
        <p style="word-break: break-all; color: #666;">${verifyUrl}</p>
        <p>This link will expire in 24 hours.</p>
        <div class="footer">
          <p>If you didn't create an account with Echolon, you can safely ignore this email.</p>
          <p>– The Echolon Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: 'Verify your Echolon account',
    html,
    text: `${greeting},\n\nThanks for signing up for Echolon! Please verify your email address by visiting:\n\n${verifyUrl}\n\nThis link will expire in 24 hours.\n\nIf you didn't create an account with Echolon, you can safely ignore this email.\n\n– The Echolon Team`,
  });
};

export const sendPasswordResetEmail = async (
  email: string,
  token: string,
  name?: string
): Promise<boolean> => {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
  const greeting = name ? `Hi ${name}` : 'Hi';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background: #22c55e; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Reset your password</h1>
        <p>${greeting},</p>
        <p>We received a request to reset your password. Click the button below to choose a new password:</p>
        <p style="margin: 30px 0;">
          <a href="${resetUrl}" class="button">Reset Password</a>
        </p>
        <p>Or copy and paste this URL into your browser:</p>
        <p style="word-break: break-all; color: #666;">${resetUrl}</p>
        <p>This link will expire in 1 hour.</p>
        <div class="footer">
          <p>If you didn't request a password reset, you can safely ignore this email.</p>
          <p>– The Echolon Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: 'Reset your Echolon password',
    html,
    text: `${greeting},\n\nWe received a request to reset your password. Visit the following URL to choose a new password:\n\n${resetUrl}\n\nThis link will expire in 1 hour.\n\nIf you didn't request a password reset, you can safely ignore this email.\n\n– The Echolon Team`,
  });
};

export const sendTeamInvitationEmail = async (
  email: string,
  token: string,
  teamName: string,
  inviterName: string
): Promise<boolean> => {
  const inviteUrl = `${FRONTEND_URL}/accept-invitation?token=${token}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background: #22c55e; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>You're invited to join ${teamName}</h1>
        <p>Hi,</p>
        <p><strong>${inviterName}</strong> has invited you to join their team <strong>${teamName}</strong> on Echolon.</p>
        <p style="margin: 30px 0;">
          <a href="${inviteUrl}" class="button">Accept Invitation</a>
        </p>
        <p>Or copy and paste this URL into your browser:</p>
        <p style="word-break: break-all; color: #666;">${inviteUrl}</p>
        <p>This invitation will expire in 7 days.</p>
        <div class="footer">
          <p>If you weren't expecting this invitation, you can safely ignore this email.</p>
          <p>– The Echolon Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `You're invited to join ${teamName} on Echolon`,
    html,
    text: `Hi,\n\n${inviterName} has invited you to join their team "${teamName}" on Echolon.\n\nAccept the invitation by visiting:\n\n${inviteUrl}\n\nThis invitation will expire in 7 days.\n\nIf you weren't expecting this invitation, you can safely ignore this email.\n\n– The Echolon Team`,
  });
};

