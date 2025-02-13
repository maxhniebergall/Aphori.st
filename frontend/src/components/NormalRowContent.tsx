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
  parentId: string;
}

const NormalRowContent: React.FC<NormalRowContentProps> = ({
  levelData,
  parentId,
}) => {
  return (
    <div className="normal-row-content">
      <StoryTreeLevelComponent
        parentId={parentId}
        levelData={levelData}
      />
    </div>
  );
};

export default NormalRowContent; 