import { LoggedDatabaseClient } from './db/LoggedDatabaseClient.js'; // For sanitizeKey
import { sendEmail as actualSendEmail } from './mailer.js';
import logger from './logger.js';

interface EmailContent {
    subject: string;
    html: string;
}

// Define email content for each mail version.
// The keys ("1", "2", etc.) correspond to the target mail version.
export const EMAIL_VERSIONS_CONTENT: Record<string, EmailContent> = {
    "1": { // Content for mail version "1"
        subject: "Replies are now available on Aphorist!",
        html: "<p>Hello {userEmail},</p><p>Replies are now available on Aphorist! You can check out the latest and comment on this new feature at https://aphori.st/postTree/03dw98bdnxquy13dbgs75tr40 </p><p>Thanks,<br/>The Aphorist Team</p>"
    },
    // Example for a future version "2"
    /*
    "2": {
        subject: "New Features on Aphori.st!",
        html: "<p>Hi {userEmail},</p><p>Check out the exciting new features we've added to Aphori.st! We hope you enjoy them.</p><p>Best,<br/>The Aphori.st Team</p>"
    }
    */
};

/**
 * Sends startup emails to a list of users for a specific target mail version.
 * Updates the 'versionLocks/mailSentList' in the database for each successfully sent email.
 * @param db - The database client instance.
 * @param usersToSend - Array of email addresses to send to.
 * @param targetVersion - The mail version being processed (e.g., "1", "2").
 * @returns An array of email addresses to whom the email was successfully sent in this run.
 */
export async function sendStartupEmails(
    db: LoggedDatabaseClient,
    usersToSend: string[],
    targetVersion: string
): Promise<string[]> {
    const sentEmailsThisRun: string[] = [];
    const emailContent = EMAIL_VERSIONS_CONTENT[targetVersion];

    if (!emailContent) {
        logger.error(`No email content defined for mail version ${targetVersion}. Cannot send startup emails.`);
        return [];
    }

    if (!(db instanceof LoggedDatabaseClient)) {
        logger.error("sendStartupEmails: Database client is not an instance of LoggedDatabaseClient. Cannot sanitize email for path construction.");
        // Depending on your setup, you might throw an error or handle this differently.
        // For now, we'll return, as sanitizeKey is crucial.
        return [];
    }

    for (const email of usersToSend) {
        if (!email || typeof email !== 'string') {
            logger.warn(`Invalid email address provided: ${email}. Skipping.`);
            continue;
        }
        try {
            // Basic personalization: replace {userEmail} placeholder
            const personalizedHtml = emailContent.html.replace(/{userEmail}/g, email);
            
            await actualSendEmail(email, emailContent.subject, personalizedHtml);
            logger.info(`Startup email for version ${targetVersion} sent to ${email}`);
            sentEmailsThisRun.push(email);

            // Update mailSentList in DB for this email. Store as a map: versionLocks/mailSentList/{sanitizedEmail}: true
            await db.addProcessedStartupEmail(email);

        } catch (error) {
            logger.error(`Failed to send startup email to ${email} for version ${targetVersion}:`, error);
            // Continue with the next email, don't let one failure stop others.
        }
    }
    return sentEmailsThisRun;
} 