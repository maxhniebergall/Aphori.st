import React, { createContext, useReducer, useContext, useEffect } from 'react';

// Define the shape of the context state
const UserContext = createContext();

// Initial state
const initialState = {
    user: null,
    loading: false,
    error: null,
};

// Reducer to handle state changes based on actions
function userReducer(state, action) {
    switch(action.type) {
        case 'AUTH_REQUEST':
            return { ...state, loading: true, error: null };
        case 'AUTH_SUCCESS':
            return { ...state, loading: false, user: action.payload };
        case 'AUTH_FAILURE':
            return { ...state, loading: false, error: action.payload };
        case 'LOGOUT':
            return { ...state, user: null };
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
        try {
            await api.sendMagicLink({ email });
            dispatch({ type: 'AUTH_SUCCESS', payload: { email } });
            // Optionally, notify the user to check their email
        } catch (error) {
            dispatch({ type: 'AUTH_FAILURE', payload: error.message });
        }
    };

    // Action to handle verifying magic link and authenticating user
    const verifyMagicLink = async (token) => {
        dispatch({ type: 'AUTH_REQUEST' });
        try {
            const response = await api.verifyMagicLink({ token });
            dispatch({ type: 'AUTH_SUCCESS', payload: response.data });
            localStorage.setItem('token', response.data.token);
        } catch (error) {
            dispatch({ type: 'AUTH_FAILURE', payload: error.message });
        }
    };

    // Action to handle user logout
    const logout = () => {
        dispatch({ type: 'LOGOUT' });
        localStorage.removeItem('token');
    };

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            // Optionally, verify the token with the backend
            api.verifyToken(token)
                .then(response => {
                    dispatch({ type: 'AUTH_SUCCESS', payload: response.data });
                })
                .catch(() => {
                    dispatch({ type: 'LOGOUT' });
                });
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