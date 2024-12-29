import axios from 'axios';

class UserOperator {
  constructor() {
    this.baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
    this.tokenCache = new Map(); // Cache for token verification results
    this.tokenCacheExpiry = new Map(); // Cache for token expiration times
    axios.defaults.headers.post['Content-Type'] = 'application/json';
  }

  // Helper method for retrying API calls
  async retryApiCall(apiCall, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await apiCall();
      } catch (error) {
        if (error.response?.status === 503 && i < retries - 1) {
          console.log(`Retrying API call after 503 error (attempt ${i + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }

  clearTokenCache(token) {
    this.tokenCache.delete(token);
    this.tokenCacheExpiry.delete(token);
  }

  async verifyToken(token) {
    try {
      const response = await this.retryApiCall(
        () => axios.post(`${this.baseURL}/api/auth/verify-token`, { token })
      );
      console.log('Verify token success response (operator):', response.data);
      return response.data;
    } catch (error) {
      console.error('Token verification error:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || 'Token verification failed' 
      };
    }
  }

  async verifyMagicLink(token) {
    try {
      const response = await this.retryApiCall(
        () => axios.post(`${this.baseURL}/api/auth/verify-magic-link`, { token })
      );
      console.log('Verify magic link success response (operator):', response.data);
      return response.data;
    } catch (error) {
      console.log('Verify magic link error response (operator):', error.response?.data);
      
      // For 300 status (user not found), pass through the response data
      if (error.response?.data?.error === 'User not found') {
        console.log('Verify magic link error response (operator) is User not found:', error.response.data);
        return {
          success: false,
          ...error.response.data,  // This spreads all fields from the response
          error: error.response.data.error,
          email: error.response.data.email,
          status: error.response.status
        };
      }

      // Handle other errors
      return { 
        success: false,
        error: error.response?.data?.error || error.message || 'Verification failed',
        status: error.response?.status
      };
    }
  }

  async sendMagicLink(email, isSignup = false) {
    try {
      await this.retryApiCall(
        () => axios.post(`${this.baseURL}/api/auth/send-magic-link`, { email, isSignup })
      );
      return { success: true };
    } catch (error) {
      console.error('Send magic link error:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || 'Failed to send magic link' 
      };
    }
  }

  // Method to manually clear the cache for a specific token or all tokens
  clearCache(token = null) {
    if (token) {
      this.clearTokenCache(token);
    } else {
      this.tokenCache.clear();
      this.tokenCacheExpiry.clear();
    }
  }

  async getProfile(token) {
    try {
      const response = await this.retryApiCall(
        () => axios.get(`${this.baseURL}/profile`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        })
      );
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error fetching profile:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || 'Failed to fetch profile' 
      };
    }
  }
}

export const userOperator = new UserOperator();
export default userOperator;