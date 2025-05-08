/*
 * Requirements:
 * - Provide an error boundary that catches rendering errors in the PostTree components.
 * - Use React lifecycle methods (getDerivedStateFromError and componentDidCatch) to catch and log errors.
 * - Display a fallback UI when an error is caught.
 * - Ensure type safety with TypeScript.
 */

import React, { ErrorInfo } from 'react';

interface PostTreeErrorBoundaryProps {
  children: React.ReactNode;
}

interface PostTreeErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PostTreeErrorBoundary extends React.Component<PostTreeErrorBoundaryProps, PostTreeErrorBoundaryState> {
  constructor(props: PostTreeErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PostTreeErrorBoundaryState {
    // Update state so the next render shows the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details for debugging purposes.
    console.error("Error caught by PostTreeErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Rendering fallback UI when an error is caught.
      return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h2>Something went wrong in the PostTree.</h2>
          <p>Please try refreshing the page or contact support if the issue persists.</p>
        </div>
      );
    }

    // If no error, render children as normal.
    return this.props.children;
  }
}

export default PostTreeErrorBoundary; 