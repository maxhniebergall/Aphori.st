import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

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
 * @returns {Promise<void>}
 */
const sendEmail = async (to, subject, html) => {
    const mailOptions = {
        from: `"Aphori.st" <${process.env.EMAIL_USERNAME}>`, // Sender address
        to, // List of recipients
        subject, // Subject line
        html, // HTML body
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${to}`);
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};

export {
    sendEmail,
};