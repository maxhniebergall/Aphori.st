/*
 * Requirements:
 * - react: Core React functionality
 * - @uiw/react-md-editor: For markdown rendering
 * - @uiw/react-md-editor/markdown-editor.css: Required CSS for markdown editor
 * - rehype-sanitize: For markdown sanitization
 * - Proper handling of text selection
 * - Support for highlighting selected text
 * - Ability to select any contiguous text in the primary node
 * - Default selection of entire text when starting
 * - Preserve selection when clicking outside
 */

import React, { useEffect, useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import rehypeSanitize from 'rehype-sanitize';

const PrimaryNodeSelection = ({ text, replyTarget }) => {
  const [selectedText, setSelectedText] = useState('');
  const [isSelectionMode] = useState(true);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [error, setError] = useState('');

  // When entering reply mode, select all text by default (only once)
  useEffect(() => {
    if (replyTarget && selectedText === '') {
      const selection = window.getSelection();
      const range = document.createRange();
      const textNode = document.querySelector('.primary-node-selection')?.firstChild;
      if (textNode) {
        range.setStart(textNode, 0);
        range.setEnd(textNode, text.length);
        selection.removeAllRanges();
        selection.addRange(range);
        setSelectedText(text);
        setSelectionStart(0);
        setSelectionEnd(text.length);
      }
    }
  }, [replyTarget, text, selectedText]);

  useEffect(() => {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(new Range(selectionStart, selectionEnd));
  }, [selectedText, selectionStart, selectionEnd]);

  const handleMouseUp = () => {
    if (replyTarget && isSelectionMode) {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      if (selectedText) {
        const range = selection.getRangeAt(0);
        const preSelectionRange = range.cloneRange();
        setSelectionStart(preSelectionRange.toString().length);
        setSelectionEnd(preSelectionRange.toString().length + range.toString().length);
        setSelectedText(selectedText);
      }
    }
  };

  const handleClick = (e) => {
    // once we have some replies, this will allow the user to display replies for a speciifc selection in the reply
  };

  return (
    <div 
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      className={`primary-node-selection ${replyTarget ? 'is-reply-target' : ''} ${!isSelectionMode ? 'highlight-mode' : ''}`}
    >
      <div data-color-mode="light">
        <MDEditor.Markdown
          source={text}
          rehypePlugins={[[rehypeSanitize]]}
          components={{
            a: ({ node, children, ...props }) => (
              <a target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            ),
          }}
        />
      </div>
    </div>
  );
};

export default PrimaryNodeSelection; 