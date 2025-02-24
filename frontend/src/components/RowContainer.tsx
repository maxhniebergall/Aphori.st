/**
 * Requirements:
 * - useDynamicRowHeight for dynamic sizing
 * - useRef to manage the row element ref
 * - Provide a common wrapper style for each row
 * - Type safety for props using TypeScript interface definitions
 */

import React, { useRef } from 'react';
import useDynamicRowHeight from '../hooks/useDynamicRowHeight';

export interface RowContainerProps {
  setSize: (visualHeight: number) => void;
  shouldHide?: boolean;
  children: React.ReactNode;
  style: React.CSSProperties;
}

function RowContainer({ setSize, shouldHide = false, children, style }: RowContainerProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  console.log("RowContainer: Initializing with props:", {
    hasSetSize: !!setSize,
    shouldHide,
    hasChildren: !!children,
    style
  });

  // Use the hook to update height and cleanup
  useDynamicRowHeight({
    rowRef,
    setSize,
    shouldHide,
  });

  const computedStyle: React.CSSProperties = {
    ...style,
    position: 'absolute',
    left: 0,
    right: 0,
    width: '100%',
    padding: shouldHide ? 0 : '20px',
    boxSizing: 'border-box',
    display: shouldHide ? 'none' : 'block',
    minHeight: shouldHide ? 0 : 100,
    overflow: 'visible',
    opacity: shouldHide ? 0 : 1,
    transition: 'opacity 0.2s ease-in-out'
  };

  console.log("RowContainer: Computed final style:", computedStyle);

  return (
    <div
      ref={rowRef}
      style={computedStyle}
      className="row-container"
      role="listitem"
    >
      {children}
    </div>
  );
}

export default RowContainer; 