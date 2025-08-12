# Themes Game - UI/Frontend Implementation Plan

## Phase 1: Core React Components (Parallel Implementation)

### 1.1 Game Grid Component
- **File**: `frontend/src/components/games/themes/GameGrid.tsx`
- **Dependencies**: None (can start immediately)
- **Features**:
  - Square grid layout (4x4 to 10x10 responsive)
  - Word display in each square
  - Click/touch selection with grey highlight
  - Maximum N selections with shake animation
  - Randomize button integration

### 1.2 Word Square Component  
- **File**: `frontend/src/components/games/themes/WordSquare.tsx`
- **Dependencies**: None (can start immediately)
- **Features**:
  - Individual word display
  - Selection state management
  - Hover effects
  - Shake animation for invalid selections
  - Touch/click handlers

### 1.3 Game Controls Component
- **File**: `frontend/src/components/games/themes/GameControls.tsx`
- **Dependencies**: None (can start immediately)
- **Features**:
  - Submit button with validation
  - Randomize button
  - Progress indicator (puzzle 1/7)
  - Attempt counter display

## Phase 2: Game Logic & State Management (Sequential after Phase 1)

### 2.1 Game State Hook
- **File**: `frontend/src/hooks/games/themes/useThemesGame.ts`
- **Dependencies**: Phase 1 components complete
- **Features**:
  - Selected words state management
  - Grid randomization logic
  - Submission validation
  - Progress tracking (completed puzzles)
  - Local storage persistence

### 2.2 Animation System
- **File**: `frontend/src/components/games/themes/animations.ts`
- **Dependencies**: Phase 1 components complete
- **Features**:
  - Shake animation for invalid selections
  - Floating text messages ("one away", "select N words")
  - Success animations for completed categories
  - Grid shuffle animations

## Phase 3: Game Screens & Flow (Sequential after Phase 2)

### 3.1 Main Game Page
- **File**: `frontend/src/pages/games/themes/ThemesGame.tsx`
- **Dependencies**: Phases 1 & 2 complete
- **Features**:
  - Daily puzzle progression (4x4 → 10x10)
  - Puzzle completion flow
  - Error handling and loading states
  - Integration with existing header

### 3.2 Games Landing Page
- **File**: `frontend/src/pages/games/GamesLanding.tsx`
- **Dependencies**: None (can implement in parallel)
- **Features**:
  - Games overview with links
  - Same header as main site
  - Initial focus on Themes game

### 3.3 Success/Share Modal
- **File**: `frontend/src/components/games/themes/ShareModal.tsx`
- **Dependencies**: Phase 2 complete
- **Features**:
  - Puzzle completion celebration
  - Emoji-based shareable results
  - Copy to clipboard functionality
  - Progress display for all daily puzzles

## Phase 4: Styling & Polish (Parallel with Phase 3)

### 4.1 Game-Specific Styles
- **File**: `frontend/src/styles/games/themes.css`
- **Dependencies**: Phase 1 components started
- **Features**:
  - Responsive grid layouts (mobile & desktop)
  - NYT Connections-inspired color scheme
  - Smooth animations and transitions
  - Accessibility considerations

### 4.2 Mobile Optimization
- **Dependencies**: Phase 3 complete
- **Features**:
  - Touch-friendly square sizes
  - Responsive breakpoints
  - Mobile-specific animations
  - Optimal viewport handling

## Implementation Notes

### Technology Stack
- React 18 with TypeScript
- CSS Modules or styled-components for styling
- React hooks for state management
- Existing Aphorist design system integration

### Integration Points
- Leverage existing header component
- Use consistent routing patterns
- Follow existing TypeScript patterns
- Integrate with existing build process

### Key Animations
1. **Shake Animation**: Invalid selection feedback
2. **Floating Text**: Dynamic feedback messages  
3. **Success Animation**: Category completion celebration
4. **Shuffle Animation**: Grid randomization visual feedback

### Responsive Design
- Mobile-first approach
- Grid squares scale appropriately
- Touch targets meet accessibility guidelines
- Smooth performance on all devices

## Success Criteria
- ✅ Smooth 60fps animations on mobile/desktop
- ✅ Intuitive touch/click interactions
- ✅ Clear visual feedback for all user actions
- ✅ Responsive design across all screen sizes
- ✅ Accessibility compliance (WCAG 2.1)
- ✅ Integration with existing Aphorist design patterns