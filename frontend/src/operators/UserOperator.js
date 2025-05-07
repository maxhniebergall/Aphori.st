import axios from 'axios';

class UserOperator {
  constructor(baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050') {
    this.baseURL = baseURL;
    this.tokenCache = new Map();
    this.tokenCacheExpiry = new Map();
  }

  clearTokenCache(token) {
    this.tokenCache.delete(token);
    this.tokenCacheExpiry.delete(token);
  }

  async verifyToken(token) {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/verify-token`, { token }, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: status => status === 200
      });
      return response.data;
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.error || error.message || 'Token verification failed' 
      };
    }
  }

  async verifyMagicLink(token) {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/verify-magic-link`, { token }, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: status => status >= 200 && status < 300
      });
      return response.data;
    } catch (error) { 
      if (error.response?.data?.error === 'User not found') {
        return {
          success: false,
          ...error.response.data,
        };
      }
      return { 
        success: false,
        error: error.response?.data?.error || error.message || 'Verification failed',
        status: error.response?.status
      };
    }
  }

  async sendMagicLink(email, isSignup = false) {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/send-magic-link`, { email, isSignupInRequest:isSignup }, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: status => status === 200
      });
      return response.data;
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.error || error.message || 'Failed to send magic link' 
      };
    }
  }

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
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        validateStatus: status => status === 200
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.error || error.message || 'Failed to fetch profile' 
      };
    }
  }
}

export const userOperator = new UserOperator();
export default userOperator;