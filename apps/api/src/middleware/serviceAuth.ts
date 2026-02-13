import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';

const client = new OAuth2Client();

export async function verifyGoogleIdentityToken(
  token: string,
  audience?: string
): Promise<{ email: string; sub: string }> {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: audience ?? config.serviceAuth.audience,
  });

  const payload = ticket.getPayload();
  if (!payload?.email || !payload?.email_verified) {
    throw new Error('Token missing verified email');
  }

  return { email: payload.email, sub: payload.sub };
}
