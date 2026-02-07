'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export interface QuoteData {
  text: string;
  sourceType: 'post' | 'reply';
  sourceId: string;
  targetAduId?: string;
}

interface TextSelectionQuoteProps {
  sourceType: 'post' | 'reply';
  sourceId: string;
  onQuote: (quote: QuoteData) => void;
  children: React.ReactNode;
}

export function TextSelectionQuote({
  sourceType,
  sourceId,
  onQuote,
  children,
}: TextSelectionQuoteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [buttonPos, setButtonPos] = useState<{ top: number; left: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');

  const handleMouseUp = useCallback(() => {
    // Small delay to let selection finalize
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setButtonPos(null);
        setSelectedText('');
        return;
      }

      const text = selection.toString().trim();
      if (text.length < 3 || text.length > 2000) {
        setButtonPos(null);
        setSelectedText('');
        return;
      }

      // Check selection is within our container
      const range = selection.getRangeAt(0);
      if (!containerRef.current?.contains(range.commonAncestorContainer)) {
        setButtonPos(null);
        setSelectedText('');
        return;
      }

      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();

      setButtonPos({
        top: rect.top - containerRect.top - 36,
        left: rect.left - containerRect.left + rect.width / 2,
      });
      setSelectedText(text);
    }, 10);
  }, []);

  const handleQuoteClick = useCallback(() => {
    onQuote({
      text: selectedText,
      sourceType,
      sourceId,
    });
    setButtonPos(null);
    setSelectedText('');
    window.getSelection()?.removeAllRanges();
  }, [selectedText, sourceType, sourceId, onQuote]);

  // Dismiss on outside click or scroll
  useEffect(() => {
    if (!buttonPos) return;

    const dismiss = () => {
      setButtonPos(null);
      setSelectedText('');
    };

    document.addEventListener('mousedown', (e) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        dismiss();
      }
    });

    return () => {
      document.removeEventListener('mousedown', dismiss);
    };
  }, [buttonPos]);

  return (
    <div ref={containerRef} className="relative" onMouseUp={handleMouseUp}>
      {children}
      {buttonPos && (
        <button
          onClick={handleQuoteClick}
          className="absolute z-10 px-2.5 py-1 text-xs font-medium text-white bg-slate-800 dark:bg-slate-200 dark:text-slate-800 rounded shadow-lg hover:bg-slate-700 dark:hover:bg-slate-300 transition-colors whitespace-nowrap"
          style={{
            top: `${buttonPos.top}px`,
            left: `${buttonPos.left}px`,
            transform: 'translateX(-50%)',
          }}
        >
          Quote reply
        </button>
      )}
    </div>
  );
}
