import React, { createContext, useReducer, useContext, useEffect } from 'react';
import { userOperator } from '../operators/UserOperator';

// Define the shape of the context state
const UserContext = createContext();

// Initial state
const initialState = {
    user: null,
    loading: false,
    error: null,
    verified: null,
};

// Development user data
const DEV_USER = {
    id: 'dev_user',
    email: 'dev@aphori.st'
};

// Reducer to handle state changes based on actions
function userReducer(state, action) {
    console.log('UserContext reducer:', { type: action.type, payload: action.payload, currentState: state });
    
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
            return { ...state, user: null, verified: null };
        default:
            return state;
    }
}

// Provider component to wrap the app
export function UserProvider({ children }) {
    const [state, dispatch] = useReducer(userReducer, initialState);

    // Add storage event listener
    useEffect(() => {
        const handleStorageChange = async (e) => {
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
    const sendMagicLink = async (email, isSignup = false) => {
        dispatch({ type: 'AUTH_REQUEST' });
        const result = await userOperator.sendMagicLink(email, isSignup);
        if (result.success) {
            dispatch({ type: 'AUTH_SENT', payload: { email } });
            return { success: true };
        } else {
            dispatch({ type: 'AUTH_FAILURE', payload: result.error });
            return { success: false, error: result.error };
        }
    };

    // Action to handle verifying magic link and authenticating user
    const verifyMagicLink = async (token) => {
        const result = await userOperator.verifyMagicLink(token);
        console.log('verifyMagicLink result:', result);  // Debug log
        
        if (result.success) {
            const userData = result.data.user;
            console.log('Setting user data:', userData);  // Debug log
            
            dispatch({ type: 'AUTH_SUCCESS', payload: userData });
            localStorage.setItem('token', result.data.token);
            localStorage.setItem('userData', JSON.stringify(userData));

            return { success: true };
        } if (result.error === 'User not found') {
            dispatch({ type: 'USER_NOT_FOUND', payload: result.error });
            return { success: false, error: result.error, result: result };
        } else {
            dispatch({ type: 'AUTH_FAILURE', payload: result.error });
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
                            console.log('Restoring user data:', parsedUserData);  // Debug log
                            dispatch({ type: 'AUTH_SUCCESS', payload: parsedUserData });
                        } else {
                            dispatch({ type: 'LOGOUT' });
                            localStorage.removeItem('token');
                            localStorage.removeItem('userData');
                        }
                    })
                    .catch(() => {
                        dispatch({ type: 'LOGOUT' });
                        localStorage.removeItem('token');
                        localStorage.removeItem('userData');
                    });
            } catch (e) {
                console.error('Error processing token:', e);
                // If token parsing fails and it's not the dev token, remove it
                if (!(process.env.NODE_ENV === 'development' && token === 'dev_token')) {
                    dispatch({ type: 'LOGOUT' });
                    localStorage.removeItem('token');
                    localStorage.removeItem('userData');
                }
            }
        }
    }, []);

    return (
        <UserContext.Provider value={{ state, sendMagicLink, verifyMagicLink, logout }}>
            {children}
        </UserContext.Provider>
    );
}

// Custom hook to use the UserContext
export function useUser() {
    return useContext(UserContext);
} 