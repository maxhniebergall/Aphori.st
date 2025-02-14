/**
 * Requirements:
 * - Render a StoryTreeLevel to display regular node content
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