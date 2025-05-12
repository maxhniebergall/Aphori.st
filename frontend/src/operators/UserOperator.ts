import axios, { AxiosError } from 'axios';
import { 
    VerifyTokenResponse, 
    VerifyMagicLinkResponse, 
    SendMagicLinkResponse, 
    ProfileResponse 
} from '../types/userAuth';

class UserOperator {
  private baseURL: string;
  private tokenCache: Map<string, any>; // Consider a more specific type if possible
  private tokenCacheExpiry: Map<string, number>; // Assuming expiry is stored as a timestamp

  constructor(baseURL = process.env.REACT_APP_API_URL || 'http://localhost:5050') {
    this.baseURL = baseURL;
    this.tokenCache = new Map<string, any>();
    this.tokenCacheExpiry = new Map<string, number>();
  }

  clearTokenCache(token: string): void {
    this.tokenCache.delete(token);
    this.tokenCacheExpiry.delete(token);
  }

  async verifyToken(token: string): Promise<VerifyTokenResponse> {
    try {
      const response = await axios.post<VerifyTokenResponse>(`${this.baseURL}/api/auth/verify-token`, { token }, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: status => status === 200
      });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<{ error: string }>;
      return {
        success: false,
        error: axiosError.response?.data?.error || axiosError.message || 'Token verification failed'
      };
    }
  }

  async verifyMagicLink(token: string): Promise<VerifyMagicLinkResponse> {
    try {
      const response = await axios.post<VerifyMagicLinkResponse>(`${this.baseURL}/api/auth/verify-magic-link`, { token }, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: status => status >= 200 && status < 300
      });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<{ error: string }>;
      if (axiosError.response?.data?.error === 'User not found') {
        // Let's assume the response structure is consistent for this specific error
        return {
          success: false,
          error: 'User not found', // Explicitly set the error message
          status: axiosError.response?.status,
           // Spread the rest of the data if needed, ensuring it matches VerifyMagicLinkResponse
          ...(axiosError.response?.data as Omit<VerifyMagicLinkResponse, 'success' | 'error' | 'status'>),
        };
      }
      return {
        success: false,
        error: axiosError.response?.data?.error || axiosError.message || 'Verification failed',
        status: axiosError.response?.status
      };
    }
  }

  async sendMagicLink(email: string, isSignup = false): Promise<SendMagicLinkResponse> {
    try {
      const response = await axios.post<SendMagicLinkResponse>(`${this.baseURL}/api/auth/send-magic-link`, { email, isSignupInRequest:isSignup }, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: status => status === 200
      });
      return response.data;
    } catch (error) {
       const axiosError = error as AxiosError<{ error: string }>;
      return {
        success: false,
        error: axiosError.response?.data?.error || axiosError.message || 'Failed to send magic link'
      };
    }
  }

  clearCache(token: string | null = null): void {
    if (token) {
      this.clearTokenCache(token);
    } else {
      this.tokenCache.clear();
      this.tokenCacheExpiry.clear();
    }
  }

  async getProfile(token: string): Promise<ProfileResponse> {
    try {
      const response = await axios.get<ProfileResponse>(`${this.baseURL}/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        validateStatus: status => status === 200
      });
      // Assuming the API directly returns the profile data structure needed by ProfileResponse['data']
      // If the actual data is nested under response.data.data, adjust accordingly.
      return { success: true, data: response.data };
    } catch (error) {
      const axiosError = error as AxiosError<{ error: string }>;
      return {
        success: false,
        error: axiosError.response?.data?.error || axiosError.message || 'Failed to fetch profile'
      };
    }
  }
}

export const userOperator = new UserOperator();
export default userOperator;