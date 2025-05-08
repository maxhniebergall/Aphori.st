/**
 * Requirements:
 * - Custom error types for enhanced error context in the post tree application.
 * - Include HTTP status code where applicable.
 * - Base PostTreeError class for common properties.
 * - Specific error classes (e.g., NodeNotFoundError) for distinct error conditions.
 */

class PostTreeError extends Error {
  public statusCode?: number;
  public endpoint?: string;
  public details?: any;

  constructor(message: string, statusCode?: number, endpoint?: string, details?: any) {
    super(message);
    this.name = "PostTreeError";
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.details = details;
  }
}

export default PostTreeError; 