import React from 'react';
import { Link } from 'react-router-dom';
import './GamesLanding.css';

export const GamesLanding: React.FC = () => {
  const currentDate = new Date().toISOString().split('T')[0];

  return (
    <div className="games-landing-container">
      <div className="games-header">
        <h1>Aphorist Games</h1>
        <p className="games-description">
          Challenge your mind with our collection of word and logic games.
        </p>
      </div>

      <div className="games-grid">
        <div className="game-card themes-card">
          <div className="game-icon">🎯</div>
          <h2>Themes</h2>
          <p>
            Find groups of four words that share a common theme. 
            Similar to NYT Connections, but with a unique twist.
          </p>
          <div className="game-features">
            <span className="feature">Daily Puzzles</span>
            <span className="feature">Progressive Difficulty</span>
            <span className="feature">4x4 to 10x10 Grids</span>
          </div>
          <Link 
            to={`/games/themes`}
            className="play-button"
          >
            Play Today's Puzzle
          </Link>
        </div>

        <div className="game-card coming-soon">
          <div className="game-icon">🧩</div>
          <h2>Word Chains</h2>
          <p>
            Connect words by changing one letter at a time. 
            Find the shortest path between two words.
          </p>
          <div className="game-features">
            <span className="feature">Coming Soon</span>
          </div>
          <button className="play-button disabled" disabled>
            Coming Soon
          </button>
        </div>

        <div className="game-card coming-soon">
          <div className="game-icon">🎲</div>
          <h2>Logic Puzzles</h2>
          <p>
            Solve complex logic problems using deductive reasoning. 
            Test your analytical thinking skills.
          </p>
          <div className="game-features">
            <span className="feature">Coming Soon</span>
          </div>
          <button className="play-button disabled" disabled>
            Coming Soon
          </button>
        </div>
      </div>

      <div className="games-info">
        <div className="info-section">
          <h3>How to Play Themes</h3>
          <ol>
            <li>Look at the grid of words</li>
            <li>Find four words that share a common theme</li>
            <li>Select them and submit your guess</li>
            <li>You have 4 attempts per puzzle</li>
            <li>Complete all categories to win!</li>
          </ol>
        </div>

        <div className="info-section">
          <h3>Daily Challenge</h3>
          <p>
            Each day features 7 new puzzles with increasing difficulty. 
            Start with a 4x4 grid and work your way up to challenging 10x10 grids!
          </p>
        </div>
      </div>
    </div>
  );
};