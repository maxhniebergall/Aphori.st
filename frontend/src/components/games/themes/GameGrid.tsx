import React from 'react';
import { WordSquare } from './WordSquare';
import './GameGrid.css';

export interface GridWord {
  word: string;
  id: string;
  categoryId?: string;
}

interface GameGridProps {
  words: GridWord[];
  selectedWords: string[];
  shakingWords: string[];
  onWordClick: (word: string) => void;
  gridSize: number;
  disabled?: boolean;
}

export const GameGrid: React.FC<GameGridProps> = ({
  words,
  selectedWords,
  shakingWords,
  onWordClick,
  gridSize,
  disabled = false
}) => {
  return (
    <div 
      className="game-grid"
      data-grid-size={`${gridSize}x${gridSize}`}
      style={{
        gridTemplateColumns: `repeat(${gridSize}, 1fr)`
      }}
    >
      {words.map((gridWord) => (
        <WordSquare
          key={gridWord.id}
          word={gridWord.word}
          isSelected={selectedWords.includes(gridWord.word)}
          isShaking={shakingWords.includes(gridWord.word)}
          onClick={() => onWordClick(gridWord.word)}
          disabled={disabled}
        />
      ))}
    </div>
  );
};