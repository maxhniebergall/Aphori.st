import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USERNAME', 'EMAIL_PASSWORD'];
/*
 * @throws {Error} If a required environment variable for the mailer is not set.
 *                 (Handled - By Design: Crashes app on start).
 */
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        // Handled - By Design: Crashes app on start if essential mailer config is missing.
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
/**
 * Verifies the Nodemailer transporter configuration.
 * Logs success or error details.
 * @throws {Error} If the transporter verification fails.
 *                 (Handled - By Design: Crashes app on start).
 */
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
        // Handled - By Design: Crashes app on start if transporter verification fails.
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
 * @throws {Error} If sending the email fails after all retry attempts.
 *                 (Handled: Propagated to the caller like server.ts routes).
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
                // Handled: Propagated to the caller (e.g., /api/auth/send-magic-link in server.ts)
                // which catches it and returns a 500 error to the client.
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