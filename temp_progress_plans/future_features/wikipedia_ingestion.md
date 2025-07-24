# Wikipedia Talk Page Ingestion System

## Overview
Design and implementation plan for ingesting Wikipedia talk pages into Aphorist, transforming discussion content into the platform's threaded reply format.

## Data Source Analysis

### Wikipedia Talk Page Structure
- **Format**: MediaWiki markup with discussion conventions
- **Threading**: Indentation-based reply structure (`:`, `::`, `:::`)
- **Signatures**: User signatures with timestamps (`~~~~`)
- **Content**: Mix of discussion, policy debates, editorial decisions
- **Volume**: Millions of pages across all language Wikipedias

### Data Access Methods
1. **Wikipedia API**: Real-time access, rate limited
2. **Wikimedia Dumps**: Bulk XML dumps, updated monthly
3. **Wikimedia EventStreams**: Real-time change feed

## Architecture Design

### Phase 1: Bulk Historical Import

#### Data Pipeline Components
```typescript
interface WikipediaTalkPagePipeline {
  extractor: WikiDumpExtractor;
  parser: TalkPageParser;
  transformer: AphoristContentTransformer;
  validator: ContentValidator;
  importer: BulkContentImporter;
}
```

#### Processing Flow
```
Wikipedia XML Dump
        ↓
   Extract Talk Pages
        ↓
   Parse Discussion Structure
        ↓
   Transform to Aphorist Format
        ↓
   Validate Content Quality
        ↓
   Bulk Import to RTDB
        ↓
   Generate Vector Embeddings
```

### Phase 2: Incremental Updates

#### Real-time Ingestion
- Subscribe to Wikimedia EventStreams
- Filter for talk page edits
- Process changes incrementally
- Handle edit conflicts and reverts

#### Change Detection
```typescript
interface TalkPageChange {
  pageTitle: string;
  revisionId: number;
  timestamp: Date;
  changeType: 'new_comment' | 'edit' | 'revert' | 'archive';
  affectedSections: string[];
}
```

## Content Transformation

### Discussion Thread Parsing

#### MediaWiki to Aphorist Mapping
```typescript
interface WikiDiscussionMapping {
  // Wikipedia talk page section → Aphorist post
  sectionToPost: {
    sectionTitle: string;
    sectionContent: string;
    author: string; // First contributor
    timestamp: Date;
  };
  
  // Indented replies → Aphorist replies
  repliesToReplies: {
    indentLevel: number;
    content: string;
    author: string;
    timestamp: Date;
    parentId: string;
  };
}
```

#### Parsing Challenges
1. **Irregular Threading**: Not all discussions follow strict indentation
2. **Unsigned Comments**: Some comments lack proper signatures
3. **Refactoring**: Discussions get reorganized, archived, split
4. **Multiple Conversations**: Single sections may contain multiple threads

#### Parsing Algorithm
```typescript
class TalkPageParser {
  parseDiscussionSection(wikitext: string): AphoristThread {
    const lines = this.splitIntoLines(wikitext);
    const comments = this.extractComments(lines);
    const threadStructure = this.buildThreadHierarchy(comments);
    return this.convertToAphoristFormat(threadStructure);
  }
  
  private extractComments(lines: string[]): WikiComment[] {
    // Extract comments with signatures and timestamps
    // Handle unsigned templates {{unsigned|username|timestamp}}
    // Parse indentation levels
  }
  
  private buildThreadHierarchy(comments: WikiComment[]): ThreadTree {
    // Build parent-child relationships based on indentation
    // Handle orphaned comments and broken threading
    // Merge related comments from same author
  }
}
```

### Content Quality Filtering

#### Inclusion Criteria
- **Substantive Discussions**: Filter out maintenance templates, bot edits
- **Minimum Length**: Exclude very short comments (< 50 characters)
- **Language**: Start with English Wikipedia, expand later
- **Active Pages**: Prioritize pages with recent activity

#### Exclusion Patterns
```typescript
const exclusionPatterns = [
  /\{\{(archive|hat|outdent|talkback|ping)\}\}/i, // Maintenance templates
  /^\s*\[\[Category:/i, // Category additions
  /^\s*\{\{(prod|afd|speedy|delete)\}/i, // Deletion discussions
  /^\s*(reverted|rv|revert)/i, // Revert notifications
];
```

### Content Attribution

#### User Identity Mapping
- Map Wikipedia usernames to synthetic Aphorist user IDs
- Preserve attribution while anonymizing
- Handle IP addresses and anonymous edits
- Create consistent identity across time

#### Metadata Preservation
```typescript
interface WikipediaSourceMetadata {
  originalPageTitle: string;
  originalRevisionId: number;
  wikipediaUsername: string;
  originalTimestamp: Date;
  importTimestamp: Date;
  sourceLanguage: string;
  qualityScore: number;
}
```

## Technical Implementation

### Data Storage Strategy

#### Staging Database
- Separate staging area for Wikipedia content
- Quality review before promoting to main database
- Batch processing and validation
- Error handling and retry mechanisms

#### Integration with Existing Schema
```json
{
  "posts": {
    "$postId": {
      "content": "...",
      "author": "wiki_user_12345",
      "source": {
        "type": "wikipedia_talk",
        "metadata": { /* WikipediaSourceMetadata */ }
      }
    }
  }
}
```

### Processing Infrastructure

#### Batch Processing System
```typescript
class WikipediaBatchProcessor {
  async processDump(dumpPath: string): Promise<ProcessingResult> {
    const pages = this.extractTalkPages(dumpPath);
    const batches = this.createBatches(pages, 1000);
    
    for (const batch of batches) {
      await this.processBatch(batch);
      await this.updateProgress(batch.id);
    }
  }
  
  private async processBatch(batch: TalkPage[]): Promise<void> {
    const threads = await Promise.all(
      batch.map(page => this.parser.parseDiscussionSection(page.content))
    );
    
    await this.validator.validateBatch(threads);
    await this.importer.importBatch(threads);
  }
}
```

#### Monitoring and Observability
- Processing progress tracking
- Error rate monitoring
- Content quality metrics
- Performance benchmarking

## Quality Assurance

### Content Validation

#### Automated Quality Checks
```typescript
interface ContentQualityMetrics {
  structuralValidity: boolean; // Valid thread structure
  contentCoherence: number; // 0-1 score
  languageQuality: number; // Grammar/spelling score
  discussionValue: number; // Substantive vs. administrative
  duplicationScore: number; // Similarity to existing content
}
```

#### Manual Review Process
- Sample-based human review
- Quality feedback loop
- Continuous improvement of parsing
- Community moderation integration

### Data Integrity

#### Consistency Checks
- Verify thread hierarchy integrity
- Check timestamp ordering
- Validate user attribution
- Detect and handle duplicates

#### Rollback Mechanisms
- Version control for import batches
- Ability to rollback problematic imports
- Incremental correction capabilities
- Data lineage tracking

## Configuration and Controls

### Import Configuration
```typescript
interface WikipediaImportConfig {
  languages: string[]; // ['en', 'es', 'fr']
  pageFilters: {
    minPageSize: number;
    maxPageSize: number;
    excludePatterns: RegExp[];
    includeNamespaces: string[];
  };
  qualityThresholds: {
    minDiscussionLength: number;
    minParticipants: number;
    contentQualityScore: number;
  };
  rateLimits: {
    apiRequestsPerSecond: number;
    concurrentProcessors: number;
    batchSize: number;
  };
}
```

### Administrative Controls
- Enable/disable import for specific languages
- Quality threshold adjustments
- Processing rate controls
- Emergency stop mechanisms

## Files to Create
- `backend/services/wikipediaIngestionService.ts`
- `backend/parsers/talkPageParser.ts`
- `backend/transformers/wikipediaContentTransformer.ts`
- `backend/validators/wikipediaContentValidator.ts`
- `backend/importers/wikipediaBulkImporter.ts`
- `backend/types/wikipediaTypes.ts`
- `backend/config/wikipediaImportConfig.ts`

## Success Metrics
- **Volume**: Successfully import 1M+ talk page discussions
- **Quality**: 95%+ content passes validation
- **Performance**: Process 10K discussions per hour
- **Accuracy**: 90%+ thread structure preservation
- **User Engagement**: Imported content generates search activity