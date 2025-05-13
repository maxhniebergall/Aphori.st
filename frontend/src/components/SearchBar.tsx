import React, { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import './SearchBar.css'; // We will create this file next for styling

interface SearchBarProps {
  initialQuery?: string;
}

const SearchBar: React.FC<SearchBarProps> = ({ initialQuery = '' }) => {
  const [query, setQuery] = useState<string>(initialQuery);
  const navigate = useNavigate();

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      navigate(`/search?query=${encodeURIComponent(trimmedQuery)}`);
    }
  };

  return (
    <form className="search-bar-container" onSubmit={handleSubmit} role="search">
      <input
        type="search"
        className="search-bar-input"
        placeholder="Search posts and replies..."
        value={query}
        onChange={handleInputChange}
        aria-label="Search query"
      />
      <button type="submit" className="search-bar-button" aria-label="Submit search">
        <span role="img" aria-label="Search icon">🔍</span>
      </button>
    </form>
  );
};

export default SearchBar; 