import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,   
    port: process.env.EMAIL_PORT,     // 465 (SSL) or 587 (TLS)
    secure: process.env.EMAIL_PORT === '465', // true for 465, false for 587
    auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
        rejectUnauthorized: true      // Enable strict certificate checking for production
    },
});

// Verify the transporter configuration
transporter.verify((error, success) => {
    if (error) {
        console.error('Error configuring Nodemailer transporter:', error);
    } else {
        console.log('Nodemailer transporter is ready to send emails.');
    }
});

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