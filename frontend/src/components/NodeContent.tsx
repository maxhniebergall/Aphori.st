/**
 * Requirements:
 * - Render node text including markdown and text selection using TextSelection
 * - If the node has a quote, render it via QuoteRenderer
 * - Provide callback support for text selection completed event
 * - TypeScript support for props, including StoryTreeNode type
 */

import React from 'react';
import TextSelection from './TextSelection';
import QuoteRenderer from './QuoteRenderer';
import { StoryTreeNode as IStoryTreeNode } from '../context/types';

interface NodeContentProps {
  node: IStoryTreeNode;
  replyTargetId?: string;
  selectionState: { start: number; end: number } | null;
  onSelectionCompleted: (selection: { start: number; end: number }) => void;
}

const NodeContent: React.FC<NodeContentProps> = ({
  node,
  replyTargetId,
  selectionState,
  onSelectionCompleted,
}) => {
  const renderQuote = () => {
    if (!node?.storyTree?.metadata?.quote) return null;
    return <QuoteRenderer quote={node.storyTree.metadata.quote} />;
  };

  return (
    <div className="story-tree-node-text">
      {renderQuote()}
      <TextSelection
        onSelectionCompleted={onSelectionCompleted}
        selectAll={false}
        selectionState={replyTargetId === node.storyTree.id ? selectionState : null}
      >
        {node.storyTree.text}
      </TextSelection>
    </div>
  );
};

export default NodeContent; 