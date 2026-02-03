import nodemailer from 'nodemailer';
import { config } from '../config.js';
import logger from '../logger.js';

let transporter: nodemailer.Transporter | null = null;
let isVerified = false;

function createTransporter(): nodemailer.Transporter {
  if (!config.email.host || !config.email.user || !config.email.pass) {
    logger.warn('Email configuration incomplete, email sending will be disabled');
    return null as unknown as nodemailer.Transporter;
  }

  return nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
}

async function verifyTransporter(): Promise<boolean> {
  if (!transporter) {
    transporter = createTransporter();
  }

  if (!transporter) {
    return false;
  }

  try {
    await transporter.verify();
    isVerified = true;
    logger.info('Email transporter verified successfully');
    return true;
  } catch (error) {
    logger.error('Email transporter verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    if (config.env === 'development') {
      logger.warn('Continuing without email capability in development mode');
      return false;
    }

    throw error;
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  retries = 3
): Promise<void> {
  if (!transporter) {
    transporter = createTransporter();
  }

  if (!transporter || !isVerified) {
    if (config.env === 'development') {
      logger.info('Email would be sent (development mode)', { to, subject });
      return;
    }
    throw new Error('Email service not available');
  }

  const mailOptions = {
    from: `"Chitin Social" <${config.email.from}>`,
    to,
    subject,
    html,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      logger.info('Email sent successfully', { to, subject, attempt });
      return;
    } catch (error) {
      logger.error(`Email send attempt ${attempt} failed`, {
        to,
        error: error instanceof Error ? error.message : String(error),
      });

      if (attempt === retries) {
        throw new Error(
          `Failed to send email after ${retries} attempts: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}

export async function initMailer(): Promise<void> {
  await verifyTransporter();
}
