import { useCallback, useMemo } from 'react';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import rehypeSanitize from 'rehype-sanitize';
import { useReplyContext } from '../context/ReplyContext';
import PostTreeOperator from '../operators/PostTreeOperator';
import CharCount from './CharCount';

// Separate Reply Editor component to isolate rendering when content changes
const ReplyEditor = () => {
  const { 
    replyTarget, 
    replyContent,
    setReplyContent,
    replyQuote,
    clearReplyState,
    clearPersistedReplyDraft
  } = useReplyContext();

  const MAX_REPLY_LENGTH = 1000;
  const MIN_REPLY_LENGTH = 50;
  const IGNORE_MIN_REPLY_LENGTH = ["Yes!"]

  // Memoize editor options
  const editorOptions = useMemo(() => ({
    preview: "edit" as const,
    height: 200,
    textareaProps: {
      placeholder: "Write your reply using Markdown...",
      autoFocus: true,
      "aria-label": "Reply editor"
    },
    previewOptions: {
      rehypePlugins: [rehypeSanitize]
    }
  }), []);

  // Handle editor change with proper types
  const handleEditorChange = useCallback((
    value?: string,
  ) => {
    if (value !== undefined) {
      setReplyContent(value);
    }
  }, [setReplyContent]);
  
  // Handle reply cancellation or successful submission
  const handleReplyFinished = useCallback(() => {
    clearReplyState(); // Call context's clear function (only clears in-memory state)
  }, [clearReplyState]);

  if (!replyTarget || !replyQuote) {
    return null;
  }

  return (
    <div 
      className="reply-editor-container"
      role="form"
      aria-label="Reply editor form"
    >
      <div data-color-mode="light">
        <MDEditor
          value={replyContent}
          onChange={handleEditorChange}
          {...editorOptions}
        />
      </div>
      <div className="char-count-container">
        {replyContent === "Yes!" ? (
          <span>"Yes!" is always allowed</span>
        ) : (
          <CharCount 
            currentLength={replyContent.length}
            maxLength={MAX_REPLY_LENGTH}
            minLength={MIN_REPLY_LENGTH}
          />  
        )}
      </div>
      <div className="reply-actions" role="group" aria-label="Reply actions">
        <button 
          onClick={async () => {
            // Trim content first
            const trimmedReplyContent = replyContent.trim();

            if (!trimmedReplyContent) {
              window.alert("Reply cannot be empty.");
              return; // Stop the submission
            }

            // If trimming changed the content, update the state via context
            if (trimmedReplyContent !== replyContent) {
              setReplyContent(trimmedReplyContent);
            }
            
            // Use trimmed content for length validation checks
            if (trimmedReplyContent.length > MAX_REPLY_LENGTH) {
              window.alert(`Reply text cannot exceed ${MAX_REPLY_LENGTH} characters.`);
              return; // Stop the submission
            }
            if (!IGNORE_MIN_REPLY_LENGTH.includes(trimmedReplyContent) && trimmedReplyContent.length < MIN_REPLY_LENGTH) {
              window.alert(`Reply text must be at least ${MIN_REPLY_LENGTH} characters long.`);
              return; // Stop the submission
            }

            // Ensure replyTarget and replyQuote are available before submitting
            if (!replyTarget || !replyQuote) {
              console.error("Cannot submit reply without target or quote.");
              window.alert("An error occurred. Please try restarting the reply.");
              handleReplyFinished(); // Clear state on error
              return;
            }

            try {
              const result = await PostTreeOperator.submitReply(trimmedReplyContent, replyTarget.id, replyQuote);
              if (!result.error) {
                clearReplyState(); // Clear in-memory state
                clearPersistedReplyDraft(); // Remove from localStorage
                window.location.reload(); // Refresh the page
              } else {
                 // Handle specific submission errors if needed, but don't clear state
                 // User might want to fix the content and retry
                 window.alert(`Failed to submit reply: ${result.error}`); 
              }
            } catch (error) {
              console.error("Error during reply submission:", error);
              window.alert("An unexpected error occurred during submission.");
              // Don't clear state here either, allow retry
            }
          }}
          className="submit-reply-button"
          aria-label="Submit reply"
        >
          Submit
        </button>
        <button 
          onClick={handleReplyFinished}
          className="cancel-reply-button"
          aria-label="Cancel reply"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ReplyEditor; 