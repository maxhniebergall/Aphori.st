# Reply Deduplication Debugging Plan

## Current Issue Status
**Date:** 2025-07-31  
**Status:** 🔧 **ACTIVE DEBUGGING**

### Primary Issue
The reply deduplication feature has been implemented but is **not working correctly**:
- Duplicate replies are being added as regular sibling replies
- Original replies are NOT being converted to `duplicateReply` format
- The duplicate detection logic may be triggering but not properly handling the conversion process

### What Was Implemented vs What's Broken

#### ✅ Successfully Implemented
- DuplicateDetectionService with vector similarity matching
- DuplicateReply TypeScript interfaces and data models
- Extended RTDB schema with duplicate-specific paths
- Duplicate comparison UI components (DuplicateComparisonPage, DuplicateVotingPanel)
- API endpoints for duplicate group retrieval
- Integration hooks in reply creation pipeline

#### ❌ Not Working Correctly
- **Core Logic Failure**: When duplicates are detected, they're not being processed correctly
- **Sibling Reply Creation**: Duplicates appear as normal sibling replies instead of special duplicate handling
- **Original Reply Conversion**: Original replies are not being moved to duplicateReply format
- **UI Info Button**: Missing info button (i) to link to duplicate comparison page

## Debugging Tasks

### Phase 1: Investigation and Root Cause Analysis
**Priority:** HIGH

1. **🔍 Code Investigation**
   - [ ] Review `/backend/services/duplicateDetectionService.ts` implementation
   - [ ] Examine `/backend/routes/replies.ts` integration logic
   - [ ] Check vector similarity threshold and detection triggering
   - [ ] Analyze database write operations in duplicate detection flow

2. **🧪 Test with Playwright MCP**
   - [ ] Create test scenario that should trigger duplicate detection
   - [ ] Use Playwright to simulate posting duplicate replies
   - [ ] Verify current behavior vs expected behavior
   - [ ] Document exact failure points and data flow

### Phase 2: Root Cause Identification
**Priority:** HIGH

3. **🐛 Find Root Cause**
   - [ ] Identify where the duplicate detection logic fails
   - [ ] Determine if issue is in:
     - Vector similarity matching not triggering
     - Detection triggering but conversion logic failing
     - Database operations not completing properly
     - Frontend not handling duplicate responses correctly

4. **📊 Data Flow Analysis**
   - [ ] Trace complete data flow from reply submission to database storage
   - [ ] Verify RTDB paths being written to during duplicate creation
   - [ ] Check if duplicate group creation is successful
   - [ ] Examine parent-child relationship handling

### Phase 3: Fix Implementation
**Priority:** HIGH

5. **🔧 Fix Duplicate Reply Logic**
   - [ ] Correct the duplicate detection conversion process
   - [ ] Ensure original replies are properly moved to duplicate format
   - [ ] Fix sibling reply creation to use duplicate handling
   - [ ] Test database operations are atomic and successful

6. **🎯 Verify Fix**
   - [ ] Test duplicate detection with known similar content
   - [ ] Verify duplicate comparison page loads correctly
   - [ ] Confirm original replies show duplicate indicators
   - [ ] Test voting functionality on duplicate groups

### Phase 4: UI Enhancements
**Priority:** MEDIUM

7. **ℹ️ Add UI Info Button**
   - [ ] Add info button (i) to reply components that have duplicates
   - [ ] Link info button to duplicate comparison page (`/dupe/$duplicateGroupId`)
   - [ ] Style info button to be discoverable but not intrusive
   - [ ] Test navigation flow from main UI to duplicate page

## Technical Investigation Areas

### Backend Services to Review
- `/backend/services/duplicateDetectionService.ts`
- `/backend/routes/replies.ts` - reply creation endpoint
- `/backend/services/vectorService.ts` - similarity search integration
- `/backend/types/index.ts` - DuplicateReply interface

### Frontend Components to Review
- `/frontend/src/components/SearchResultsPage.tsx`
- `/frontend/src/components/SearchResultsPageRow.tsx`
- `/frontend/src/operators/SearchOperator.ts`
- `/frontend/src/types/search.ts`

### Database Paths to Verify
```
/duplicateReplies/$duplicateReplyId
/duplicateGroups/$groupId
/indexes/duplicatesByGroup/$groupId/$replyId
/replies/$replyId (should be moved to duplicateReplies)
```

## Success Criteria

### Fixed Implementation Should:
1. **Detect duplicates** when similarity threshold (0.08) is exceeded
2. **Convert original reply** to duplicateReply format and move to correct RTDB path
3. **Create duplicate group** with proper metadata and indexing
4. **Show duplicate indicator** in main UI with info button linking to comparison page
5. **Load comparison page** successfully at `/dupe/$duplicateGroupId`
6. **Handle voting** on duplicate groups (if user interaction required)

### Testing Validation:
- [ ] Playwright tests pass for duplicate creation scenario
- [ ] Manual testing confirms duplicate detection and UI flow
- [ ] Database inspection shows correct data structure
- [ ] No sibling replies created when duplicates detected
- [ ] Info button navigation works correctly

## Next Steps
1. **Start with code investigation** to understand current implementation
2. **Use Playwright MCP** to create reproducible test case
3. **Identify exact failure point** in the duplicate detection pipeline
4. **Implement targeted fix** based on root cause analysis
5. **Add UI info button** once backend logic is working
6. **Comprehensive testing** to ensure fix is complete

## Notes
- Original implementation plan: `../future_features/reply_deduplication.md`
- The core infrastructure was successfully built, but the execution logic has bugs
- Focus on the conversion process from regular reply to duplicate reply handling
- UI components exist but may need integration fixes once backend is working