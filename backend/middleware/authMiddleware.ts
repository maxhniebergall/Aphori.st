import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../logger.js';
import { AuthenticatedRequest, User } from '../types/index.js'; // Assuming types are in ../types

// Authentication middleware function
export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        res.status(401).json({ error: 'Token required.' });
        return;
    }

    // In development, accept the dev token
    if (process.env.NODE_ENV !== 'production' && token === 'dev_token') {
        (req as AuthenticatedRequest).user = {
            id: 'dev_user',
            email: 'dev@aphori.st'
        };
        next();
        return;
    }

    if (!process.env.AUTH_TOKEN_SECRET) {
        logger.error('AUTH_TOKEN_SECRET not configured.');
        res.status(500).json({ error: 'Auth token secret not configured.' });
        return;
    }

    jwt.verify(token, process.env.AUTH_TOKEN_SECRET, (err: jwt.VerifyErrors | null, decoded: any) => {
        if (err) {
            logger.warn({ err: err.message, tokenProvided: true }, 'Invalid token verification');
            res.status(403).json({ error: 'Invalid token.' });
            return;
        }
        (req as AuthenticatedRequest).user = decoded as User;
        next();
    });
}; 