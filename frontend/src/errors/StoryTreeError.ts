/**
 * Requirements:
 * - Custom error types for enhanced error context in the story tree application.
 * - Encapsulate error code, message, endpoint, and additional details.
 */

class StoryTreeError extends Error {
  public statusCode?: number;
  public endpoint?: string;
  public details?: any;

  constructor(message: string, statusCode?: number, endpoint?: string, details?: any) {
    super(message);
    this.name = "StoryTreeError";
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.details = details;
  }
}

export default StoryTreeError; 