import axios from 'axios';

class UserOperator {
  constructor() {
    this.baseURL = process.env.REACT_APP_API_URL;
    axios.defaults.headers.post['Content-Type'] = 'application/json';
  }

  async sendMagicLink(email) {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/send-magic-link`, {
        email: email
      });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error sending magic link:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || 'Failed to send magic link' 
      };
    }
  }

  async verifyMagicLink(token) {
    try {
      const response = await axios.post(`${this.baseURL}/auth/verify-magic-link`, {
        token: token
      });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error verifying magic link:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || 'Failed to verify magic link' 
      };
    }
  }

  async verifyToken(token) {
    try {
      const response = await axios.post(`${this.baseURL}/auth/verify-token`, {
        token: token
      });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error verifying token:', error);
      return { 
        success: false, 
        error: error.response?.data?.error || 'Failed to verify token' 
      };
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