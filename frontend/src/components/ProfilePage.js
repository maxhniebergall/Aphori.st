import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import axios from 'axios';

function ProfilePage() {
    const { state } = useUser();
    const [profile, setProfile] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/profile`, {
                    headers: {
                        'Authorization': `Bearer ${state.user.token}`,
                    },
                });
                setProfile(response.data);
            } catch (err) {
                setError('Failed to fetch profile.');
            }
        };

        if (state.user && state.user.token) {
            fetchProfile();
        }
    }, [state.user]);

    if (error) {
        return <div className="error">{error}</div>;
    }

    if (!profile) {
        return <div>Loading profile...</div>;
    }

    return (
        <div className="profile-page">
            <h1>User Profile</h1>
            <p><strong>Email:</strong> {profile.email}</p>
            {/* Add more user-specific information here */}
        </div>
    );
}

export default ProfilePage; 