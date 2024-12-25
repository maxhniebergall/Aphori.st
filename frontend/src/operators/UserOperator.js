import axios from 'axios';

class UserOperator {
  constructor() {
    this.baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
    this.tokenCache = new Map(); // Cache for token verification results
    this.tokenCacheExpiry = new Map(); // Cache for token expiration times
    this.CACHE_DURATION = 5 * 60 * 1000; // Cache results for 5 minutes
    axios.defaults.headers.post['Content-Type'] = 'application/json';
  }

  clearTokenCache(token) {
    this.tokenCache.delete(token);
    this.tokenCacheExpiry.delete(token);
  }

  async verifyToken(token) {
    // Check cache first
    if (this.tokenCache.has(token)) {
      const cacheExpiry = this.tokenCacheExpiry.get(token);
      if (cacheExpiry > Date.now()) {
        return this.tokenCache.get(token);
      } else {
        // Clear expired cache entry
        this.clearTokenCache(token);
      }
    }

    try {
      const response = await axios.post(`${this.baseURL}/api/auth/verify-token`, { token });
      const result = { success: true, data: response.data };
      
      // Cache the successful result
      this.tokenCache.set(token, result);
      this.tokenCacheExpiry.set(token, Date.now() + this.CACHE_DURATION);
      
      return result;
    } catch (error) {
      console.error('Token verification error:', error);
      const result = { 
        success: false, 
        error: error.response?.data?.error || 'Token verification failed' 
      };
      
      // Cache the failure result for a shorter duration
      this.tokenCache.set(token, result);
      this.tokenCacheExpiry.set(token, Date.now() + (this.CACHE_DURATION / 5)); // Cache failures for 1 minute
      
      return result;
    }
  }

  async verifyMagicLink(token) {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/verify-magic-link`, { token });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Magic link verification error:', error);
      // If it's a 300 status and includes the email, this is for signup flow
      if (error.response?.status === 300) {
        return {
          success: false,
          status: 300,
          data: error.response.data
        };
      }
      return { 
        success: false, 
        error: error.response?.data?.error || 'Magic link verification failed' 
      };
    }
  }

  async sendMagicLink(email, isSignup = false) {
    try {
      await axios.post(`${this.baseURL}/api/auth/send-magic-link`, { email, isSignup });
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
      const response = await axios.get(`${this.baseURL}/profile`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
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