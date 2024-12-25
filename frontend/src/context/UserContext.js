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

// Reducer to handle state changes based on actions
function userReducer(state, action) {
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

    // Action to handle sending magic link
    const sendMagicLink = async (email) => {
        dispatch({ type: 'AUTH_REQUEST' });
        const result = await userOperator.sendMagicLink(email);
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
        
        if (result.success) {
            dispatch({ type: 'AUTH_SUCCESS', payload: result.data });
            localStorage.setItem('token', result.data.token);
            localStorage.setItem('userData', JSON.stringify(result.data));

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
        
        if (token && userData) {
            try {
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
                            // Use the stored user data if verification succeeds
                            dispatch({ type: 'AUTH_SUCCESS', payload: JSON.parse(userData) });
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
                // If token parsing fails, remove it
                dispatch({ type: 'LOGOUT' });
                localStorage.removeItem('token');
                localStorage.removeItem('userData');
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