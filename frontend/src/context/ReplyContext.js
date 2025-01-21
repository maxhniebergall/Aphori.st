import React, { createContext, useContext, useState } from 'react';

const ReplyContext = createContext();

export function ReplyProvider({ children }) {
  const [replyTarget, setReplyTarget] = useState(null);
  const [replyContent, setReplyContent] = useState('');
  const [selectionState, setSelectionState] = useState(null);

  return (
    <ReplyContext.Provider value={{
      replyTarget,
      setReplyTarget,
      replyContent,
      setReplyContent,
      selectionState,
      setSelectionState
    }}>
      {children}
    </ReplyContext.Provider>
  );
}

export function useReplyContext() {
  return useContext(ReplyContext);
} 