import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import logger from '../logger.js';
import {
    User,
    UserResult,
    ExistingUser,
    AuthTokenPayload,
    TokenPayload,
    DatabaseClient as DatabaseClientType
} from '../types/index.js';
import { sendEmail } from '../mailer.js';
import { LogContext } from '../db/loggingTypes.js';

// Use the imported type for the placeholder and the setDb function
let db: DatabaseClientType;
export const setDb = (databaseClient: DatabaseClientType) => {
    db = databaseClient;
};

const router = Router();

// Constants for user-related keys - REMOVED, using direct paths now
// const USER_PREFIX = 'user';
// const USER_IDS_SET = 'user_ids';
// const EMAIL_TO_ID_PREFIX = 'email_to_id';

// --- Helper Functions ---

// Helper to escape email for Firebase keys (using percent encoding)
// Duplicates FirebaseClient.sanitizeKey logic for now
function escapeEmailForKey(email: string): string {
    let encoded = encodeURIComponent(email);
    encoded = encoded.replace(/\./g, '%2E');
    encoded = encoded.replace(/\$/g, '%24');
    encoded = encoded.replace(/#/g, '%23');
    encoded = encoded.replace(/\[/g, '%5B');
    encoded = encoded.replace(/\]/g, '%5D');
    encoded = encoded.replace(/\//g, '%2F');
    return encoded;
}

const getUserById = async (id: string, context?: LogContext): Promise<UserResult> => {
    // Read directly from the /users/$userId path
    const userPath = `users/${id}`;
    // logger.debug({ ...context, path: userPath }, 'Attempting to get user by ID'); // Optional debug log
    const userData = await db.get<ExistingUser>(userPath, context);
    if (!userData) {
        // logger.debug({ ...context, path: userPath }, 'User not found by ID'); // Optional debug log
        return {
            success: false,
            error: 'User not found'
        };
    }
    // logger.debug({ ...context, path: userPath, userId: userData.id }, 'User found by ID'); // Optional debug log
    return {
        success: true,
        data: userData // Should be the ExistingUser object
    };
};

const getUserByEmail = async (email: string, context?: LogContext): Promise<UserResult> => {
    const lowerEmail = email.toLowerCase();
    const escapedEmail = escapeEmailForKey(lowerEmail);
    // Get user ID from email mapping in userMetadata
    const emailMapPath = `userMetadata/emailToId/${escapedEmail}`;
    // logger.debug({ ...context, path: emailMapPath }, 'Attempting to get user ID by email'); // Optional debug log
    const userId = await db.get<string>(emailMapPath, context);
    if (!userId) {
        // logger.debug({ ...context, path: emailMapPath, email: lowerEmail }, 'User ID not found for email'); // Optional debug log
        return {
            success: false,
            error: 'User not found'
        };
    }
    // logger.debug({ ...context, path: emailMapPath, email: lowerEmail, userId }, 'Found user ID for email, getting user data'); // Optional debug log
    return getUserById(userId, context); // Reuse getUserById
};

const createUser = async (id: string, email: string, context?: LogContext): Promise<UserResult> => {
    const lowerEmail = email.toLowerCase();
    const escapedEmail = escapeEmailForKey(lowerEmail);
    const userPath = `users/${id}`;
    const emailMapPath = `userMetadata/emailToId/${escapedEmail}`;
    const userIdSetKey = 'userIds:all'; // Key for sAdd, maps to userMetadata/userIds/$id

    // Use transactions or multi-path updates for atomicity if possible,
    // but for now, perform checks and writes sequentially.

    // Check if ID is taken (read from new path)
    const existingUserCheck = await db.get(userPath, context);
    if (existingUserCheck) {
        return {
            success: false,
            error: 'User ID already exists'
        };
    }

    // Check if email is already registered (read from new path)
    const existingEmailCheck = await db.get(emailMapPath, context);
    if (existingEmailCheck) {
        return {
            success: false,
            error: 'Email already registered'
        };
    }

    const newUser: ExistingUser = {
        id,
        email: lowerEmail, // Store lowercase email
        createdAt: new Date().toISOString()
    };

    try {
        // Store user data at /users/$id
        await db.set(userPath, newUser, context);
        // Add ID to set of user IDs at /userMetadata/userIds/$id
        await db.sAdd(userIdSetKey, id, context);
        // Create email to ID mapping at /userMetadata/emailToId/$escapedEmail
        await db.set(emailMapPath, id, context);

        return {
            success: true,
            data: newUser
        };
    } catch (error: any) {
        logger.error({ ...context, err: error, userId: id, email: lowerEmail }, 'Database error creating user');
        // Consider trying to clean up partial writes if possible, though complex.
        return {
            success: false,
            error: 'Server error creating user'
        };
    }
};

const generateMagicToken = (email: string): string => {
    return jwt.sign(
        { email } as TokenPayload,
        process.env.MAGIC_LINK_SECRET as string,
        { expiresIn: '15m' }
    );
};

const generateAuthToken = (user: User): string => {
    return jwt.sign(
        { id: user.id, email: user.email } as AuthTokenPayload,
        process.env.AUTH_TOKEN_SECRET as string,
        { expiresIn: '7d' }
    );
};

// Apply to magic link route
const magicLinkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 5 requests per windowMs
    message: 'Too many magic link requests from this IP, please try again later.',
});


// --- Routes --- (Moved from server.ts)

/**
 * @route   POST /auth/send-magic-link
 * @desc    Sends a magic link to the user's email for authentication
 * @access  Public
 */
router.post('/send-magic-link', magicLinkLimiter, async (req, res) => {
    const { email, isSignupInRequest } = req.body;

    if (!email) {
        logger.error('Missing email in request body');
        res.status(400).json({
            success: false,
            error: 'Email is required'
        });
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        logger.error('Invalid email format: %s', email);
        res.status(400).json({
            success: false,
            error: 'Invalid email format'
        });
        return;
    }

    try {
        const userResult = await getUserByEmail(email);
        const isSignup = isSignupInRequest === true || userResult?.error === 'User not found';
        logger.info({ body: req.body, isSignup, userResult }, "Server: send-magic-link request");

        let token;
        if (process.env.NODE_ENV == 'production') {
            token = generateMagicToken(email);
        } else {
            token = 'dev_token'; // Allow dev token in non-prod
        }

        const baseUrl = isSignup ? 'https://aphori.st/signup' : 'https://aphori.st/verify';
        const magicLink = `${baseUrl}?token=${token}&email=${encodeURIComponent(email)}`

        const subject = isSignup ? 'Complete Your Sign Up' : 'Your Magic Link to Sign In';
        const actionText = isSignup ? 'complete your sign up' : 'sign in';
        const html = `
            <p>Hi,</p>
            <p>Click <a href="${magicLink}">here</a> to ${actionText}. This link will expire in 15 minutes.</p>
            <p>If you did not request this email, you can safely ignore it.</p>
            <p>Thanks,<br/>Aphori.st Team</p>
        `;

        await sendEmail(email, subject, html);
        logger.info('Magic link sent successfully to: %s', email);
        res.json({
            success: true,
            message: 'Magic link sent to your email'
        });
    } catch (error) {
        logger.error({ err: error }, 'Failed to send magic link');
        res.status(500).json({
            success: false,
            error: 'Failed to send magic link'
        });
    }
});

/**
 * @route   POST /auth/verify-magic-link
 * @desc    Verifies the magic link token and authenticates the user
 * @access  Public
 */
router.post('/verify-magic-link', async (req, res) => {
    const { token } = req.body;
    logger.info('Received verify-magic-link request with token: %s', token ? 'present' : 'absent');

    if (!token) {
        logger.warn('No token provided in request');
        res.status(400).json({
            success: false,
            error: 'Token is required'
        });
        return;
    }

    try {
        logger.info('Attempting to verify JWT token');
        const decoded = jwt.verify(token, process.env.MAGIC_LINK_SECRET as string);
        logger.info('Successfully decoded token: %O', decoded);
        if (typeof decoded !== 'object' || !decoded.email) {
            throw new Error('Invalid token payload');
        }

        logger.info('Looking up user by email: %s', decoded.email);
        const userResult = await getUserByEmail(decoded.email);
        logger.info('User lookup result: %O', userResult);

        if (!userResult.success) {
            logger.warn('User not found for email: %s', decoded.email);
            res.status(401).json({
                success: false,
                error: 'User not found',
                email: decoded.email
            });
            return;
        }

        logger.info('Generating auth token for user: %O', userResult.data);
        if (!userResult.data) {
            throw new Error('User data not found');
        }
        const authToken = generateAuthToken(userResult.data);

        logger.info('Successfully verified magic link for user: %s', userResult.data.id);
        res.json({
            success: true,
            data: {
                token: authToken,
                user: {
                    id: userResult.data.id,
                    email: userResult.data.email
                }
            }
        });
    } catch (error) {
        if (error instanceof Error) {
            logger.error({ err: error, tokenProvided: !!token }, 'Error verifying magic link');
        } else {
            logger.error({ error, tokenProvided: !!token }, 'Unknown error verifying magic link');
        }
        res.status(400).json({
            success: false,
            error: 'Invalid or expired token'
        });
    }
});

/**
 * @route   POST /auth/verify-token
 * @desc    Verifies the authentication token
 * @access  Public
 */
router.post('/verify-token', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        res.status(400).json({
            success: false,
            error: 'Token is required'
        });
        return;
    }

    if (process.env.NODE_ENV !== 'production' && token === 'dev_token') {
        res.json({
            success: true,
            data: {
                id: 'dev_user',
                email: 'dev@example.com' // Using example.com for dev
            }
        });
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.AUTH_TOKEN_SECRET as string) as AuthTokenPayload;
        const userResult = await getUserById(decoded.id);

        if (!userResult.success) {
            res.status(400).json({
                success: false,
                error: 'Invalid token'
            });
            return;
        }

        res.json({
            success: true,
            data: {
                id: decoded.id,
                email: decoded.email
            }
        });
    } catch (error) {
        logger.error({ err: error }, 'Token verification failed');
        res.status(400).json({
            success: false,
            error: 'Invalid or expired token'
        });
    }
});

/**
 * @route   GET /auth/check-user-id/:id
 * @desc    Check if a user ID is available
 * @access  Public
 */
router.get('/check-user-id/:id', async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const requestId = res.locals.requestId;
    const logContext = { requestId };

    if (!id || id.length < 3) {
        logger.warn({ ...logContext, providedId: id }, 'User ID check failed validation (too short)');
        res.status(400).json({ 
            success: false,
            error: 'ID must be at least 3 characters long',
            available: false
        });
        return;
    }

    try {
        const userResult = await getUserById(id, logContext);
        logger.info({ ...logContext, userId: id, available: !userResult.success }, 'Checked user ID availability');
        res.json({ 
            success: true,
            available: !userResult.success
        });
    } catch (error) {
        logger.error({ ...logContext, userId: id, err: error }, 'Error checking user ID availability');
        res.status(500).json({ 
            success: false,
            error: 'Server error checking ID availability',
            available: false
        });
    }
});

/**
 * @route   POST /auth/signup
 * @desc    Creates a new user account
 * @access  Public (but requires verification token usually)
 */
router.post('/signup', async (req: Request, res: Response) => {
    const { id, email, verificationToken } = req.body;
    // Generate IDs for logging
    const operationId = randomUUID();
    const requestId = res.locals.requestId;
    const logContext = { requestId, operationId };

    logger.info({ ...logContext, userId: id, emailProvided: !!email, tokenProvided: !!verificationToken }, 'Received signup request');

    if (!id || !email) {
        logger.warn({ ...logContext, userId: id, emailProvided: !!email }, 'Signup failed: Missing ID or email');
        res.status(400).json({ 
            success: false,
            error: 'ID and email are required'
        });
        return;
    }

    // Verification Token Check
    if (verificationToken) {
        try {
            const decoded = jwt.verify(verificationToken, process.env.MAGIC_LINK_SECRET as string);
            if (typeof decoded !== 'object' || !decoded.email) {
                throw new Error('Invalid token payload');
            }
            if (decoded.email !== email) {
                logger.warn({ ...logContext, userId: id, emailInToken: decoded.email, emailInBody: email }, 'Signup failed: Email mismatch between token and request body');
                res.status(400).json({
                    success: false,
                    error: 'Email does not match verification token'
                });
                return;
            }
            logger.info({ ...logContext, userId: id, email }, 'Signup verification token validated successfully');
        } catch (error: any) {
            logger.error({ ...logContext, userId: id, email, err: error }, 'Signup failed: Invalid or expired verification token');
            res.status(400).json({
                success: false,
                error: 'Invalid or expired verification token'
            });
            return;
        }
    } else {
        // Optional: Decide if signup *requires* a verification token
        // If so, return an error here. For now, allow signup without token.
        logger.warn({ ...logContext, userId: id, email }, 'Signup proceeding without verification token');
    }

    // Log action intent before calling createUser
    logger.info(
        { 
            ...logContext,
            action: {
                type: 'CREATE_USER',
                params: { userId: id, email }
            },
        },
        'Initiating CreateUser action'
    );

    // Pass context to createUser
    const result = await createUser(id, email, logContext);

    if (!result.success || !result.data) {
        // Error already logged within createUser if it was a DB error
        // Log context-specific error if needed (e.g., ID/email taken)
        logger.warn({ ...logContext, userId: id, email, creationError: result.error }, `User creation failed: ${result.error}`);
        res.status(400).json(result);
        return;
    }

    // Generate auth token ONLY if a verification token was provided and valid
    let authToken = null;
    if (verificationToken) {
        authToken = generateAuthToken(result.data);
        logger.info({ ...logContext, userId: id }, 'Generated auth token after successful signup with verification');
    }

    logger.info({ ...logContext, userId: id }, 'User created successfully');
    res.json({ 
        success: true,
        message: 'User created successfully',
        data: authToken ? { token: authToken, user: result.data } : undefined
    });
});

export default router;
