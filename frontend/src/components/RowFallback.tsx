/**
 * Requirements:
 * - Provide error logging for invalid node structures
 * - Display an appropriate fallback message
 */

import React from 'react';

interface RowFallbackProps {
  message?: string;
  style?: React.CSSProperties;
  index?: number;
}

const RowFallback: React.FC<RowFallbackProps> = ({ message = 'Loading node...', style }) => {
  return (
    <div className="fallback-row" style={style}>
      <div className="fallback-placeholder">{message}</div>
    </div>
  );
};

export default RowFallback; 