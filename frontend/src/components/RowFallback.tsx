/**
 * Requirements:
 * - Provide error logging for invalid node structures
 * - Display an appropriate fallback message
 */

import React from 'react';

interface RowFallbackProps {
  message?: string;
}

const RowFallback: React.FC<RowFallbackProps> = ({ message = 'Loading node...' }) => {
  return (
    <div className="fallback-row">
      <div className="fallback-placeholder">{message}</div>
    </div>
  );
};

export default RowFallback; 