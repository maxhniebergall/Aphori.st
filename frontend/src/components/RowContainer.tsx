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

  // Use the hook to update height and cleanup
  useDynamicRowHeight({
    rowRef,
    setSize,
    shouldHide,
  });

  // The component also handles forward ref responsibilities.
  return (
    <div
      ref={rowRef}
      style={{
        ...style,
        position: 'absolute',
        left: 0,
        right: 0,
        width: '100%',
        padding: shouldHide ? 0 : '20px',
        boxSizing: 'border-box',
        height: shouldHide ? 0 : undefined,
        overflow: shouldHide ? 'hidden' : 'visible',
        opacity: shouldHide ? 0 : 1,
        pointerEvents: shouldHide ? 'none' : 'auto'
      }}
    >
      {children}
    </div>
  );
}

export default RowContainer; 