/**
 * Requirements:
 * - Display a loading placeholder
 * - Use accessible markup for loading state (e.g. ARIA roles if needed)
 * - Minimal styling to indicate progress
 */

import React from 'react';

const RowLoading: React.FC = () => {
  return (
    <div className="loading-row">
      <div className="loading-placeholder">Loading...</div>
    </div>
  );
};

export default RowLoading; 