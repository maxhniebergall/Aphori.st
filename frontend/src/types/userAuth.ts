import { ReactNode } from 'react';

// --- Types from UserOperator.ts ---

export interface VerifyTokenResponse {
  success: boolean;
  error?: string;
  // Add other fields if expected from the API
}

export interface VerifyMagicLinkResponse {
  success: boolean;
  data?: {
    user: User; // Defined below
    token: string;
  };
  error?: string;
  status?: number;
  isSignup?: boolean;
}

export interface SendMagicLinkResponse {
  success: boolean;
  error?: string;
}

export interface ProfileResponse {
  success: boolean;
  data?: any; // Define a proper user profile type later
  error?: string;
}

// --- Types from UserContext.tsx ---

// Define user type (replace 'any' with a more specific type)
export type User = any;

export interface UserState {
    user: User | null;
    loading: boolean;
    error: string | null;
    verified: boolean | null;
}

export type UserAction = 
    | { type: 'AUTH_REQUEST' }
    | { type: 'AUTH_SENT'; payload: { email: string } }
    | { type: 'AUTH_SUCCESS'; payload: User }
    | { type: 'AUTH_FAILURE'; payload: string }
    | { type: 'USER_NOT_FOUND'; payload: string }
    | { type: 'LOGOUT' };

export interface UserContextType {
    state: UserState;
    sendMagicLink: (email: string, isSignup?: boolean) => Promise<{ success: boolean; error?: string }>;
    verifyMagicLink: (token: string) => Promise<{ success: boolean; error?: string, result?: VerifyMagicLinkResponse }>; // Use specific response type
    logout: () => void;
}

export interface UserProviderProps {
    children: ReactNode;
}

// --- Types from AuthModal.tsx ---

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSignIn: (email: string) => Promise<{ success: boolean; error?: string }>;
}

// --- Types from Header.tsx ---

export interface HeaderProps {
  onLogoClick: () => void;
}
