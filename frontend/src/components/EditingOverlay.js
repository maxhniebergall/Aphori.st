// File: /frontend/src/components/EditingOverlay.js

import React, { useState } from 'react';
import ReactQuill from 'react-quill';
import './EditingOverlay.css';
import 'react-quill/dist/quill.snow.css';

function EditingOverlay({ node, onClose }) {
  const [content, setContent] = useState(node.text);

  const handleSave = () => {
    // Logic to save the edited content
    // You can send a POST request to your backend to update the node
    console.log('Saving content:', content);
    onClose();
  };

  return (
    <div className="editing-overlay">
      <div className="editing-modal">
        <ReactQuill value={content} onChange={setContent} />
        <div className="editing-buttons">
          <button onClick={handleSave}>Save</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default EditingOverlay;
