import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export interface Mailer {
  sendMail(msg: MailMessage): Promise<void>;
}

/** SMTP via nodemailer — the default transport (unchanged behaviour). */
class SmtpMailer implements Mailer {
  private readonly transporter: nodemailer.Transporter;
  constructor(config: ConfigService) {
    const port = config.get('SMTP_PORT', '587');
    this.transporter = nodemailer.createTransport({
      host: config.get('SMTP_HOST'),
      port: parseInt(port),
      secure: port === '465',
      auth: { user: config.get('SMTP_USER'), pass: config.get('SMTP_PASS') },
    });
  }
  async sendMail(msg: MailMessage): Promise<void> {
    await this.transporter.sendMail(msg);
  }
}

/** AWS SES — activated with MAIL_DRIVER=ses. Credentials come from the EC2 IAM role. */
class SesMailer implements Mailer {
  private readonly client: SESClient;
  constructor(config: ConfigService) {
    this.client = new SESClient({ region: config.get('AWS_REGION', 'us-east-1') });
  }
  async sendMail(msg: MailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        Source: msg.from,
        Destination: { ToAddresses: [msg.to] },
        Message: {
          Subject: { Data: msg.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: msg.html, Charset: 'UTF-8' } },
        },
      }),
    );
  }
}

/**
 * Build the configured mailer, or null if email isn't set up (so the app still
 * runs in-app-only). MAIL_DRIVER=smtp (default) requires SMTP_HOST;
 * MAIL_DRIVER=ses uses AWS SES from the instance role.
 */
export function createMailer(config: ConfigService): Mailer | null {
  const driver = config.get('MAIL_DRIVER', 'smtp').toLowerCase();
  const logger = new Logger('Mailer');

  if (driver === 'ses') {
    logger.log('Mail driver: ses');
    return new SesMailer(config);
  }
  if (config.get('SMTP_HOST')) {
    logger.log('Mail driver: smtp');
    return new SmtpMailer(config);
  }
  logger.warn('No SMTP_HOST and MAIL_DRIVER!=ses — email disabled (in-app notifications only)');
  return null;
}
