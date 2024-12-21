import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import newLogger from './logger.js';

dotenv.config();

const logger = newLogger("mailer.js");

// Validate required environment variables
const requiredEnvVars = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USERNAME', 'EMAIL_PASSWORD'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10),
    secure: process.env.EMAIL_PORT === '465',
    auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    debug: process.env.NODE_ENV !== 'production',
    logger: process.env.NODE_ENV !== 'production'
});

// Verify the transporter configuration with better error handling
const verifyTransporter = async () => {
    try {
        await transporter.verify();
        console.log('Nodemailer transporter is ready to send emails.');
    } catch (error) {
        console.error('Error configuring Nodemailer transporter:', {
            message: error.message,
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT
        });
        throw error;
    }
};

verifyTransporter();

/**
 * Sends an email using the configured transporter.
 * @param {string} to - Recipient's email address.
 * @param {string} subject - Subject of the email.
 * @param {string} html - HTML content of the email.
 * @param {number} retries - Number of retry attempts.
 * @returns {Promise<void>}
 */
const sendEmail = async (to, subject, html, retries = 3) => {
    const mailOptions = {
        from: `"Aphori.st" <${process.env.EMAIL_USERNAME}>`,
        to,
        subject,
        html,
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await transporter.sendMail(mailOptions);
            logger.info(`Email sent to ${to} successfully on attempt ${attempt}`);
            return;
        } catch (error) {
            logger.error(`Attempt ${attempt} to send email to ${to} failed:`, error);
            
            if (attempt === retries) {
                throw new Error(`Failed to send email after ${retries} attempts: ${error.message}`);
            }
            
            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }
};

export {
    sendEmail,
};