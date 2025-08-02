# Themes Game - Routing & Integration Implementation Plan

## Phase 1: Domain & Infrastructure Setup (Parallel Implementation)

### 1.1 Subdomain Configuration

- **Task**: Configure games.aphori.st subdomain
- **Dependencies**: None (can start immediately)
- **Technical Requirements**:
  - DNS configuration for games.aphori.st
  - SSL certificate setup for subdomain
  - CDN configuration if applicable
  - Load balancer routing rules

### 1.2 Express Server Routing Setup

- **File**: `backend/src/app.ts` (modifications)
- **Dependencies**: None (can start immediately)
- **Features**:
  - Add games subdomain routing middleware
  - Configure CORS for games.aphori.st
  - Set up games-specific middleware stack
  - Add games route prefix handling

### 1.3 Frontend Build Configuration

- **File**: Frontend build/deployment configuration
- **Dependencies**: None (can start immediately)
- **Features**:
  - Configure React Router for subdomain routing
  - Set up games-specific build targets
  - Configure asset paths for games subdomain
  - Update deployment scripts for multi-domain setup

## Phase 2: Backend Route Integration (Sequential after Phase 1.2)

### 2.1 Games Route Module Setup

- **File**: `backend/src/routes/games/index.ts`
- **Dependencies**: Phase 1.2 complete
- **Features**:
  - Central games routing configuration
  - Themes game route mounting
  - Future games route planning
  - Common games middleware

### 2.2 Themes Game Routes Integration

- **File**: `backend/src/routes/games/themes/index.ts`
- **Dependencies**: Phase 2.1 complete, Backend API implementation phases
- **Features**:
  - Mount all themes API endpoints
  - Configure games-specific authentication
  - Add games route middleware
  - Set up error handling for games routes

### 2.3 API Path Configuration

- **File**: `backend/src/config/routes.ts`
- **Dependencies**: Phase 2.2 complete
- **Features**:
  - Define API path constants for games
  - Configure route versioning for games
  - Set up route documentation
  - Add API endpoint validation

## Phase 3: Frontend Route Integration (Sequential after UI components)

### 3.1 Games Router Setup

- **File**: `frontend/src/router/gamesRouter.tsx`
- **Dependencies**: UI components implementation started
- **Features**:
  - React Router configuration for games subdomain
  - Route definitions for games landing and themes
  - Route guards for puzzle progression
  - Error boundary setup for games routes

### 3.2 Games Landing Page Route

- **File**: `frontend/src/pages/games/GamesLanding.tsx`
- **Dependencies**: Phase 3.1 complete
- **Features**:
  - Landing page at games.aphori.st root
  - Navigation to available games
  - Future games preview/coming soon
  - Integration with existing header component

### 3.3 Themes Game Routes

- **File**: `frontend/src/pages/games/themes/ThemesRoutes.tsx`
- **Dependencies**: Phase 3.1 complete, UI components implementation
- **Features**:
  - Main themes game route (games.aphori.st/themes)
  - Daily puzzle progression routes
  - Shareable results routes
  - Error and not found page handling

## Phase 4: Header Integration (Parallel with Phase 3)

### 4.1 Header Component Analysis

- **Task**: Analyze existing header component structure
- **Dependencies**: None (immediate analysis required)
- **Objectives**:
  - Understand current header component architecture
  - Identify integration points for games link
  - Document existing navigation patterns
  - Plan responsive behavior for games section

### 4.2 Header Navigation Extension

- **File**: Existing header component modifications
- **Dependencies**: Phase 4.1 complete
- **Features**:
  - Add "Games" navigation link
  - Configure link to games.aphori.st
  - Ensure consistent styling with existing nav
  - Handle active state for games subdomain

### 4.3 Mobile Navigation Integration

- **File**: Mobile header/navigation modifications
- **Dependencies**: Phase 4.2 complete
- **Features**:
  - Add games link to mobile navigation
  - Ensure proper responsive behavior
  - Maintain consistent mobile UX
  - Test across different device sizes

## Phase 5: Cross-Domain Integration (Sequential after Phases 2-4)

### 5.1 Authentication Integration

- **File**: Games authentication middleware
- **Dependencies**: Temporary user service implementation
- **Features**:
  - Magic link authentication for games subdomain
  - Temporary user cookie management
  - Cross-domain session handling
  - Migration from temporary to permanent users

### 5.2 Analytics Integration

- **File**: Games analytics configuration
- **Dependencies**: Phase 5.1 complete
- **Features**:
  - Track games subdomain usage
  - User flow analytics across domains
  - Game-specific event tracking
  - Performance monitoring for games

### 5.3 SEO & Meta Configuration

- **File**: Games SEO configuration
- **Dependencies**: Phase 5.2 complete
- **Features**:
  - Meta tags for games pages
  - Open Graph configuration for sharing
  - Sitemap generation for games content
  - Schema markup for games

## Phase 6: Production Deployment (Sequential after All Phases)

### 6.1 Environment Configuration

- **Files**: Production configuration files
- **Dependencies**: All previous phases complete
- **Features**:
  - Production environment variables for games
  - Database connection configuration
  - CDN configuration for games assets
  - Monitoring and logging setup

### 6.2 Deployment Pipeline

- **Files**: CI/CD pipeline modifications
- **Dependencies**: Phase 6.1 complete
- **Features**:
  - Games-specific build and deployment
  - Multi-domain deployment validation
  - Rollback procedures for games
  - Health checks for games functionality

### 6.3 DNS & SSL Configuration

- **Task**: Production DNS and SSL setup
- **Dependencies**: Phase 6.2 complete
- **Features**:
  - Configure production DNS for games.aphori.st
  - SSL certificate setup and renewal
  - CDN configuration and caching rules
  - Load balancer configuration

## Implementation Details

### Routing Architecture

#### Domain Structure
```text
aphori.st/           → Main Aphorist application
games.aphori.st/     → Games landing page
games.aphori.st/themes → Themes game
```

#### Frontend Route Configuration
```typescript
// games.aphori.st routing
const gamesRoutes = [
  { path: '/', component: GamesLanding },
  { path: '/themes', component: ThemesGame },
  { path: '/themes/share/:date', component: ShareableResults }
];
```

#### Backend API Structure
```text
API Base: https://games.aphori.st/api/
/api/games/themes/daily/:date          → Daily puzzles
/api/games/themes/progress             → User progress
/api/games/themes/attempt              → Submit attempts
/api/games/themes/shareable/:date      → Shareable results
```

### Header Integration Strategy

#### Navigation Addition
- Add "Games" link between existing navigation items
- Use consistent styling and hover effects
- Ensure accessibility compliance
- Handle active state when on games subdomain

#### Cross-Domain Navigation
- Seamless navigation between main site and games
- Preserve user authentication state
- Maintain consistent header appearance
- Handle subdomain routing properly

### Authentication Flow

#### Anonymous Users
1. **First Visit**: Generate temporary user ID, set cookie
2. **Cross-Domain**: Cookie valid on games.aphori.st subdomain
3. **Progress Tracking**: Store progress under temporary ID
4. **Registration**: Migrate progress to permanent account

#### Logged-In Users
1. **Magic Link**: Works across both domains
2. **Session Sharing**: Authentication valid on games subdomain
3. **Progress Sync**: Automatic migration from any temporary progress
4. **Consistent UX**: Same experience as main site

### Performance Considerations

#### Route Loading
- Lazy load games components for faster main site performance
- Prefetch games assets when user hovers over games link
- Optimize bundle splitting for games functionality
- Implement proper loading states for games routes

#### Cross-Domain Optimization
- CDN configuration for games subdomain
- Proper caching headers for games assets
- Minimize cross-domain requests
- Optimize initial load time for games landing

### SEO & Social Sharing

#### Meta Tags Configuration
```html
<!-- Games Landing -->
<title>Aphorist Games - Word Puzzle Games</title>
<meta name="description" content="Play word puzzle games including Themes, a Connections-style game" />

<!-- Themes Game -->
<title>Themes - Daily Word Connection Puzzles | Aphorist Games</title>
<meta name="description" content="Daily word connection puzzles using semantic similarity" />
```

#### Open Graph Setup
- Custom OG images for games pages
- Proper OG titles and descriptions
- Twitter card configuration
- Shareable results with custom formatting

### Security Considerations

#### Cross-Domain Security
- Proper CORS configuration for games API
- Secure cookie handling across subdomains
- XSS protection for games content
- Rate limiting for games endpoints

#### User Data Protection
- Secure temporary user ID generation
- Proper data encryption for stored attempts
- GDPR compliance for games analytics
- Secure cleanup of expired temporary users

## Success Criteria

- ✅ Games accessible at games.aphori.st with proper routing
- ✅ Seamless navigation from main site header to games
- ✅ Themes game functional at games.aphori.st/themes
- ✅ Proper authentication handling for both logged-in and anonymous users
- ✅ Cross-domain session management working correctly
- ✅ Games header integration maintains design consistency
- ✅ Mobile responsive navigation includes games link
- ✅ Production deployment with proper DNS and SSL
- ✅ Analytics tracking across main site and games subdomain
- ✅ SEO optimization for games discoverability