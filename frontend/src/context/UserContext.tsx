import { createContext, useReducer, useContext, useEffect } from 'react';
import { userOperator } from '../operators/UserOperator';
import { 
    User, 
    UserState, 
    UserAction, 
    UserContextType, 
    UserProviderProps, 
    VerifyMagicLinkResponse
} from '../types/userAuth';


const UserContext = createContext<UserContextType | undefined>(undefined);

// Initial state
const initialState: UserState = {
    user: null,
    loading: false,
    error: null,
    verified: null,
};

// Development user data
const DEV_USER: User = {
    id: 'dev_user',
    email: 'dev@aphori.st'
};

// Reducer to handle state changes based on actions
function userReducer(state: UserState, action: UserAction): UserState {    
    switch(action.type) {
        case 'AUTH_REQUEST':
            return { ...state, loading: true, error: null };
        case 'AUTH_SENT':
            return { ...state, loading: false, user: action.payload, verified: false };
        case 'AUTH_SUCCESS':
            return { ...state, loading: false, user: action.payload, verified: true };
        case 'AUTH_FAILURE':
            return { ...state, loading: false, error: action.payload, verified: false };
        case 'USER_NOT_FOUND':
            return { ...state, loading: false, error: action.payload, verified: false };
        case 'LOGOUT':
            return { ...initialState }; // Reset to initial state on logout
        default:
            return state;
    }
}
// Provider component to wrap the app
export function UserProvider({ children }: UserProviderProps) {
    const [state, dispatch] = useReducer(userReducer, initialState);

    // Add storage event listener
    useEffect(() => {
        const handleStorageChange = async (e: StorageEvent) => {
            if (e.key === 'token' || e.key === 'userData') {
                if (!e.newValue) {
                    // Item was removed
                    dispatch({ type: 'LOGOUT' });
                } else if (e.key === 'userData') {
                    // userData was updated - verify token with backend
                    const token = localStorage.getItem('token');
                    if (token) {
                        const result = await userOperator.verifyToken(token);
                        if (result.success) {
                            const userData = JSON.parse(e.newValue);
                            dispatch({ type: 'AUTH_SUCCESS', payload: userData });
                        } else {
                            // Token verification failed
                            dispatch({ type: 'LOGOUT' });
                            localStorage.removeItem('token');
                            localStorage.removeItem('userData');
                        }
                    }
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    // Action to handle sending magic link
    const sendMagicLink = async (email: string, isSignup = false): Promise<{ success: boolean; error?: string }> => {
        dispatch({ type: 'AUTH_REQUEST' });
        const result = await userOperator.sendMagicLink(email, isSignup);
        if (result.success) {
            dispatch({ type: 'AUTH_SENT', payload: { email } });
            return { success: true };
        } else {
            dispatch({ type: 'AUTH_FAILURE', payload: result.error || 'Unknown error sending magic link' });
            return { success: false, error: result.error };
        }
    };

    // Action to handle verifying magic link and authenticating user
    const verifyMagicLink = async (token: string): Promise<{ success: boolean; error?: string, result?: VerifyMagicLinkResponse }> => {
        const result = await userOperator.verifyMagicLink(token);
        
        if (result.success && result.data) {
            const userData = result.data.user;
            
            dispatch({ type: 'AUTH_SUCCESS', payload: userData });
            localStorage.setItem('token', result.data.token);
            localStorage.setItem('userData', JSON.stringify(userData));

            return { success: true };
        } if (result.error === 'User not found') {
            dispatch({ type: 'USER_NOT_FOUND', payload: result.error });
            return { success: false, error: result.error, result: result };
        } else {
            dispatch({ type: 'AUTH_FAILURE', payload: result.error || 'Unknown magic link verification error' });
            return { success: false, error: result.error};
        }
    };

    // Action to handle user logout
    const logout = () => {
        dispatch({ type: 'LOGOUT' });
        localStorage.removeItem('token');
        localStorage.removeItem('userData');
    };

    useEffect(() => {
        const token = localStorage.getItem('token');
        const userData = localStorage.getItem('userData');
        
        // In development, automatically provide a token if none exists
        if (process.env.NODE_ENV === 'development' && (!token || token === 'dev_token')) {
            console.log('Development environment detected, setting development token');
            const devToken = 'dev_token';
            localStorage.setItem('token', devToken);
            localStorage.setItem('userData', JSON.stringify(DEV_USER));
            dispatch({ type: 'AUTH_SUCCESS', payload: DEV_USER });
            return;
        }
        
        if (token && userData) {
            try {
                // Skip token validation for development token
                if (process.env.NODE_ENV === 'development' && token === 'dev_token') {
                    const parsedUserData = JSON.parse(userData);
                    dispatch({ type: 'AUTH_SUCCESS', payload: parsedUserData });
                    return;
                }

                const payload = JSON.parse(atob(token.split('.')[1]));
                const expiry = payload.exp * 1000; // Convert to milliseconds
                
                if (expiry < Date.now()) {
                    // Token is expired, just remove it and logout
                    dispatch({ type: 'LOGOUT' });
                    localStorage.removeItem('token');
                    localStorage.removeItem('userData');
                    return;
                }
                
                userOperator.verifyToken(token)
                    .then(result => {
                        if (result.success) {
                            const parsedUserData = JSON.parse(userData);
                            dispatch({ type: 'AUTH_SUCCESS', payload: parsedUserData });
                        } else {
                            dispatch({ type: 'LOGOUT' });
                            localStorage.removeItem('token');
                            localStorage.removeItem('userData');
                        }
                    })
                    .catch(() => {
                        // If token parsing fails, always logout and remove items
                        // The check for dev_token seems redundant here as it would be caught earlier if valid
                        dispatch({ type: 'LOGOUT' });
                        localStorage.removeItem('token');
                        localStorage.removeItem('userData');
                    });
            } catch (e) {
                console.error('Error processing token:', e);
                // If token parsing fails, always logout and remove items
                // The check for dev_token seems redundant here as it would be caught earlier if valid
                dispatch({ type: 'LOGOUT' });
                localStorage.removeItem('token');
                localStorage.removeItem('userData');
            }
        } else {
            // If there's no token or userData, ensure logged out state
            dispatch({ type: 'LOGOUT' });
        }
    }, []);

    return (
        <UserContext.Provider value={{ state, sendMagicLink, verifyMagicLink, logout }}>
            {children}
        </UserContext.Provider>
    );
}

// Custom hook to use the UserContext
export function useUser(): UserContextType {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
} 