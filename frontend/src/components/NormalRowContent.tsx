/**
 * Requirements:
 * - Render a StoryTreeLevel to display regular node content
 * - Pass down proper props such as onSiblingChange and fetchNode
 * - Ensure consistency with parent's state for reply handling
 */

import React from 'react';
import { StoryTreeLevel } from '../types/types';
import StoryTreeLevelComponent from './StoryTreeLevel';

interface NormalRowContentProps {
  levelData: StoryTreeLevel;
}

const NormalRowContent: React.FC<NormalRowContentProps> = ({
  levelData,
}) => {
  return (
    <div className="normal-row-content">
      <StoryTreeLevelComponent
        levelData={levelData}
      />
    </div>
  );
};

export default NormalRowContent; 