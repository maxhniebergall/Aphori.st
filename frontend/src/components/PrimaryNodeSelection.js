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

import React, { useEffect, useRef, useState } from 'react';
import MDEditor, { commands } from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import rehypeSanitize from 'rehype-sanitize';

const PrimaryNodeSelection = ({ text, replyTarget }) => {
  const [selectedText, setSelectedText] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(true);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [markedText, setMarkedText] = useState('');

  // When entering reply mode, select all text by default (only once)
  useEffect(() => {
    if (replyTarget && selectedText === '') {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(new Range(0, text.length));
      setSelectedText(text);
      setSelectionStart(0);
      setSelectionEnd(text.length);
        }
  }, [replyTarget, text]);

  useEffect(() => {
    console.log("selectedText: ", selectedText);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(new Range(selectionStart, selectionEnd));
    let markedText = text.replace(selection.toString(), `<span class="marked-text">${selection.toString()}</span>`);
    setMarkedText(markedText);
  }, [selectedText]);

//   // Handle clicks outside the component
//   useEffect(() => {
//     document.addEventListener('mousedown', handleClickOutside);
//     return () => {
//       document.removeEventListener('mousedown', handleClickOutside);
//     };
//   }, [isSelectionMode, onSelectionChange]);

  const handleMouseUp = () => {
    if (replyTarget && isSelectionMode) {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      console.log("selectedText: ", selectedText);
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