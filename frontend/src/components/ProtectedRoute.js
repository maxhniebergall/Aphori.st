import React from 'react';
import { Navigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';

/**
 * ProtectedRoute component to guard protected routes.
 * @param {React.ReactNode} children - Child components to render if authenticated.
 * @returns {React.ReactNode} - Either the children or a Navigate component.
 */
const ProtectedRoute = ({ children }) => {
    const { user } = useUser();

    if (!user) {
        // Redirect to /login if not authenticated
        return <Navigate to="/login" replace />;
    }

    return children;
};

export default ProtectedRoute; 