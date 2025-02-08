/**
 * Requirements:
 * - Render node text including markdown and text selection using TextSelection
 * - If the node has a quote, render it via QuoteRenderer
 * - Provide callback support for text selection completed event
 * - TypeScript support for props, including StoryTreeLevel type
 */

import React from 'react';
import TextSelection from './TextSelection';
import QuoteRenderer from './QuoteRenderer';
import { StoryTreeLevel, Quote } from '../context/types';

interface NodeContentProps {
  node: StoryTreeLevel;
  replyTargetId?: string;
  selectionState: { start: number; end: number } | null;
  onSelectionComplete?: (selection: { start: number; end: number }) => void;
}

const NodeContent: React.FC<NodeContentProps> = ({
  node,
  replyTargetId,
  selectionState,
  onSelectionComplete = () => {},
}) => {
  const quote = node?.storyTree?.metadata?.quote;
  const isQuoteTarget = replyTargetId === node?.storyTree?.id;

  return (
    <div className="node-content">
      {quote && <QuoteRenderer quote={quote as Quote} />}
      <TextSelection
        onSelectionCompleted={onSelectionComplete}
        selectionState={isQuoteTarget ? selectionState : null}
      >
        {node.storyTree?.text || ''}
      </TextSelection>
    </div>
  );
};

export default NodeContent; 