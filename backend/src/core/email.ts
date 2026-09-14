import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Email delivery, behind one interface with two real implementations.
 *
 *  - `console` (default for development): the message is written to the server log.
 *    Nothing about verification is faked — the code is genuinely generated, hashed,
 *    stored, rate limited and checked. Only the transport is local, and the API
 *    marks such responses `devMode: true` so the UI can say so honestly.
 *  - `smtp`: real delivery through nodemailer using the SMTP_* settings.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: 'console' | 'smtp';
  /** True when messages are not actually delivered to a mailbox. */
  readonly isDevMode: boolean;
  send(message: EmailMessage): Promise<void>;
}

const consoleProvider: EmailProvider = {
  name: 'console',
  isDevMode: true,
  async send(message) {
    const divider = '─'.repeat(64);
    // Written with console.log directly so the code is easy to spot while demoing.
    console.log(
      `\n${divider}\n` +
        `  ✉  CampusBuddy — development email (not actually delivered)\n` +
        `  To:      ${message.to}\n` +
        `  Subject: ${message.subject}\n` +
        `${divider}\n${message.text}\n${divider}\n`,
    );
  },
};

function createSmtpProvider(): EmailProvider {
  let transporter: import('nodemailer').Transporter | null = null;

  return {
    name: 'smtp',
    isDevMode: false,
    async send(message) {
      if (!transporter) {
        const nodemailer = await import('nodemailer');
        transporter = nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          // Port 465 is implicit TLS; 587 upgrades with STARTTLS.
          secure: env.SMTP_PORT === 465,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
        });
      }
      await transporter.sendMail({
        from: env.SMTP_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      logger.info('Verification email sent', { provider: 'smtp' });
    },
  };
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!provider) {
    provider = env.EMAIL_PROVIDER === 'smtp' ? createSmtpProvider() : consoleProvider;
    if (provider.isDevMode && !env.isTest) {
      logger.warn(
        'EMAIL_PROVIDER=console — verification codes appear in this log instead of a mailbox. Set EMAIL_PROVIDER=smtp for real delivery.',
      );
    }
  }
  return provider;
}

/** Test hook: swap in a provider that records messages instead of sending them. */
export function __setEmailProviderForTests(next: EmailProvider | null): void {
  provider = next;
}

export function buildOtpEmail(fullName: string, code: string, ttlMinutes: number): EmailMessage {
  const text = [
    `Hi ${fullName},`,
    '',
    `Your CampusBuddy verification code is: ${code}`,
    '',
    `It expires in ${ttlMinutes} minutes.`,
    'If you did not request this, you can safely ignore this email.',
    '',
    '— CampusBuddy',
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 16px;color:#1f2937">Verify your student account</h2>
      <p style="color:#4b5563">Hi ${escapeHtml(fullName)},</p>
      <p style="color:#4b5563">Your CampusBuddy verification code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;background:#f3f4f6;
                padding:16px;border-radius:12px;text-align:center;margin:24px 0">${escapeHtml(code)}</p>
      <p style="color:#6b7280;font-size:14px">This code expires in ${ttlMinutes} minutes.
         If you did not request it, you can ignore this email.</p>
    </div>`;

  return { to: '', subject: `CampusBuddy verification code: ${code}`, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
