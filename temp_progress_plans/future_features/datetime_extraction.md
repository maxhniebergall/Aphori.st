# DateTime Event Extraction System

## Overview
Design and implementation of a temporal entity recognition system to extract datetime events from Aphorist content, generating structured tuples: `(eventName, datetime, within, ...metadata)` where `within` represents the standard error in days.

## System Architecture

### Core Components
```typescript
interface DateTimeExtractionPipeline {
  textProcessor: TemporalTextProcessor;
  entityRecognizer: TemporalEntityRecognizer;
  dateParser: FlexibleDateParser;
  accuracyEstimator: TemporalAccuracyEstimator;
  eventClassifier: EventClassifier;
  validator: DateTimeValidator;
  storage: DateTimeDatastore;
}
```

### Data Flow
```
Content Text
     ↓
Temporal Expression Detection (dates, events, time references)
     ↓
Date/Time Parsing & Normalization
     ↓
Event Entity Recognition & Classification
     ↓
Accuracy Assessment (mantissa calculation)
     ↓
Context Analysis & Validation
     ↓
Structured Tuple Generation
     ↓
Historical Event Correlation & Storage
```

## Temporal Expression Recognition

### Date Pattern Detection

#### Comprehensive Date Patterns
```typescript
const datePatterns = [
  // Absolute dates
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/g,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
  
  // Historical periods
  /\b(\d{1,4})\s*(BC|BCE|AD|CE)\b/gi,
  /\b(\d{1,4})s?\s*(BC|BCE|AD|CE)?\b/g, // "1960s", "500 BC"
  
  // Relative dates
  /\b(yesterday|today|tomorrow)\b/gi,
  /\b(\d+)\s+(days?|weeks?|months?|years?)\s+(ago|from now|later)\b/gi,
  /\blast\s+(week|month|year|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi,
  
  // Approximate dates
  /\b(around|about|circa|approximately|roughly)\s+(\d{4})\b/gi,
  /\b(early|mid|late)\s+(\d{4})\b/gi,
  /\b(early|mid|late)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi,
  
  // Time periods
  /\bbetween\s+(\d{4})\s+and\s+(\d{4})\b/gi,
  /\bfrom\s+(\d{4})\s+to\s+(\d{4})\b/gi,
  /\b(\d{4})-(\d{4})\b/g,
  
  // Seasons
  /\b(spring|summer|autumn|fall|winter)\s+(\d{4})\b/gi,
  
  // Special formats
  /\bQ[1-4]\s+(\d{4})\b/gi, // Quarters: Q1 2023
  /\b(\d{4})Q[1-4]\b/gi,
  /\b(\d{1,2})(st|nd|rd|th)\s+century\b/gi,
  /\b(\d{1,4})\s*million\s+years?\s+ago\b/gi
];
```

#### Time Expression Patterns
```typescript
const timePatterns = [
  // Absolute times
  /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?\b/g,
  /\b(\d{1,2})\s*(AM|PM|am|pm)\b/g,
  
  // Relative times
  /\b(noon|midnight|dawn|dusk|sunrise|sunset)\b/gi,
  /\b(morning|afternoon|evening|night)\b/gi,
  
  // Time zones
  /\b(\d{1,2}):(\d{2})\s*(UTC|GMT|EST|PST|CST|MST)([+-]\d{1,2})?\b/gi
];
```

### Event Pattern Recognition

#### Event Type Classification
```typescript
interface EventType {
  category: 'historical' | 'personal' | 'natural' | 'technological' | 'cultural' | 'political';
  subcategory: string;
  keywords: string[];
  temporalIndicators: string[];
}

const eventTypes: EventType[] = [
  {
    category: 'historical',
    subcategory: 'war',
    keywords: ['war', 'battle', 'invasion', 'siege', 'revolution', 'conflict'],
    temporalIndicators: ['began', 'ended', 'started', 'concluded', 'lasted']
  },
  {
    category: 'historical',
    subcategory: 'political',
    keywords: ['election', 'treaty', 'independence', 'constitution', 'coup'],
    temporalIndicators: ['signed', 'elected', 'declared', 'ratified', 'established']
  },
  {
    category: 'natural',
    subcategory: 'disaster',
    keywords: ['earthquake', 'tsunami', 'hurricane', 'volcano', 'flood'],
    temporalIndicators: ['occurred', 'struck', 'erupted', 'hit', 'devastated']
  },
  {
    category: 'technological',
    subcategory: 'invention',
    keywords: ['invented', 'discovered', 'developed', 'created', 'launched'],
    temporalIndicators: ['first', 'initially', 'originally', 'debut', 'release']
  }
];
```

#### Named Event Recognition
```typescript
class EventEntityRecognizer {
  async recognizeEvents(text: string): Promise<EventEntity[]> {
    const entities = [];
    
    // Recognize named historical events
    const namedEvents = await this.findNamedEvents(text);
    entities.push(...namedEvents);
    
    // Recognize event patterns with temporal markers
    const patternEvents = await this.findEventPatterns(text);
    entities.push(...patternEvents);
    
    // Recognize biographical events
    const bioEvents = await this.findBiographicalEvents(text);
    entities.push(...bioEvents);
    
    return this.deduplicateEvents(entities);
  }
  
  private async findNamedEvents(text: string): Promise<EventEntity[]> {
    // Match against database of known historical events
    const knownEvents = [
      { name: "World War II", aliases: ["WWII", "Second World War"], category: "historical" },
      { name: "American Civil War", aliases: ["Civil War"], category: "historical" },
      { name: "Moon Landing", aliases: ["Apollo 11"], category: "technological" },
      // ... extensive database
    ];
    
    return this.matchKnownEvents(text, knownEvents);
  }
}
```

## Date Parsing & Normalization

### Flexible Date Parser

#### Multi-Format Date Parsing
```typescript
class FlexibleDateParser {
  parseDate(dateString: string, context: string): ParsedDate {
    const parsers = [
      this.parseAbsoluteDate,
      this.parseRelativeDate,
      this.parseApproximateDate,
      this.parseHistoricalDate,
      this.parsePeriodDate
    ];
    
    for (const parser of parsers) {
      try {
        const result = parser(dateString, context);
        if (result.confidence > 0.7) {
          return result;
        }
      } catch (error) {
        // Continue to next parser
      }
    }
    
    return this.createUnknownDate(dateString);
  }
  
  private parseHistoricalDate(dateString: string): ParsedDate {
    const bcPattern = /(\d+)\s*(BC|BCE)/i;
    const match = dateString.match(bcPattern);
    
    if (match) {
      const year = parseInt(match[1]);
      return {
        datetime: new Date(-year + 1, 0, 1), // BCE years as negative
        precision: 'year',
        confidence: 0.9,
        era: 'BCE'
      };
    }
    
    // Handle CE/AD dates, centuries, etc.
    return this.parseCommonEraDate(dateString);
  }
}
```

#### Date Accuracy Estimation (Standard Error)

```typescript
interface DateAccuracy {
  within: number; // Standard error in days
  precision: 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year' | 'decade' | 'century';
  confidence: number; // Parser confidence in the interpretation
}

class TemporalAccuracyEstimator {
  calculateStandardError(parsedDate: ParsedDate, originalText: string): DateAccuracy {
    const precision = this.determinePrecision(parsedDate, originalText);
    const within = this.calculateStandardError(precision, originalText);
    
    return {
      within,
      precision,
      confidence: parsedDate.confidence
    };
  }
  
  private determinePrecision(parsedDate: ParsedDate, originalText: string): string {
    // Analyze original text to determine precision
    if (/\d{1,2}:\d{2}:\d{2}/.test(originalText)) return 'second';
    if (/\d{1,2}:\d{2}/.test(originalText)) return 'minute';
    if (/\d{1,2}\s*(AM|PM)/.test(originalText)) return 'hour';
    if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(originalText)) return 'day';
    if (/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/.test(originalText)) return 'month';
    if (/^\d{4}$/.test(originalText.trim())) return 'year';
    if (/\d{4}s/.test(originalText)) return 'decade';
    if (/\d{1,2}(st|nd|rd|th)\s+century/.test(originalText)) return 'century';
    
    return 'year'; // Default
  }
  
  private calculateStandardError(precision: string, originalText: string): number {
    // Base standard error in days for different precision levels
    const baseStandardError = {
      'second': 0.0001, // ~8.6 seconds
      'minute': 0.0007, // ~1 minute
      'hour': 0.02,     // ~30 minutes
      'day': 0.5,       // ~12 hours
      'month': 15,      // ~2 weeks
      'year': 180,      // ~6 months
      'decade': 1825,   // ~5 years
      'century': 18250  // ~50 years
    };
    
    let baseError = baseStandardError[precision] || 365;
    
    // Adjust based on textual uncertainty indicators
    if (/(about|around|circa|approximately|roughly)/i.test(originalText)) {
      baseError *= 2; // Double uncertainty for approximate dates
    }
    
    if (/(early|late)/i.test(originalText)) {
      baseError *= 1.5; // Increase uncertainty for "early 1990s", "late 2000s"
    }
    
    if (/between|from.*to/i.test(originalText)) {
      baseError *= 3; // Higher uncertainty for date ranges
    }
    
    return Math.round(baseError * 100) / 100; // Round to 2 decimal places
  }
}
```

## Event-DateTime Association

### Event Context Analysis

#### Temporal Relationship Detection
```typescript
interface TemporalRelationship {
  eventName: string;
  datetime: Date;
  accuracy: DateAccuracy;
  relationship: 'exact' | 'start' | 'end' | 'during' | 'before' | 'after' | 'approximate';
  textEvidence: string;
  confidence: number;
}

class EventDateTimeAssociator {
  associateEventWithDateTime(eventEntity: EventEntity, dateEntities: DateEntity[], context: string): TemporalRelationship[] {
    const associations = [];
    
    for (const dateEntity of dateEntities) {
      const proximity = this.calculateProximity(eventEntity, dateEntity, context);
      const relationship = this.determineRelationship(eventEntity, dateEntity, context);
      
      if (proximity > 0.5) {
        associations.push({
          eventName: eventEntity.name,
          datetime: dateEntity.parsedDate.datetime,
          accuracy: dateEntity.accuracy,
          relationship,
          textEvidence: this.extractEvidence(eventEntity, dateEntity, context),
          confidence: Math.min(proximity, dateEntity.parsedDate.confidence)
        });
      }
    }
    
    return this.rankAssociations(associations);
  }
  
  private determineRelationship(event: EventEntity, date: DateEntity, context: string): string {
    const relationshipIndicators = {
      exact: ['on', 'at', 'during'],
      start: ['began', 'started', 'commenced', 'launched'],
      end: ['ended', 'concluded', 'finished', 'completed'],
      before: ['before', 'prior to', 'preceding'],
      after: ['after', 'following', 'subsequent to'],
      approximate: ['around', 'about', 'circa', 'roughly']
    };
    
    const surroundingText = this.extractSurroundingText(event, date, context);
    
    for (const [relationship, indicators] of Object.entries(relationshipIndicators)) {
      if (indicators.some(indicator => surroundingText.includes(indicator))) {
        return relationship;
      }
    }
    
    return 'approximate'; // Default
  }
}
```

### Event Classification and Enrichment

#### Historical Event Database Integration
```typescript
interface HistoricalEventDatabase {
  searchEvent(eventName: string): Promise<HistoricalEvent[]>;
  getEventByDate(date: Date, tolerance: number): Promise<HistoricalEvent[]>;
  verifyEventDate(eventName: string, date: Date): Promise<VerificationResult>;
}

interface HistoricalEvent {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  startDate: Date;
  endDate?: Date;
  accuracy: DateAccuracy;
  description: string;
  sources: string[];
  confidence: number;
}

class EventEnricher {
  async enrichEvent(extraction: DateTimeExtraction): Promise<EnrichedEvent> {
    // Cross-reference with historical databases
    const historicalMatches = await this.historicalDB.searchEvent(extraction.eventName);
    
    // Verify date consistency
    const verification = await this.verifyEventDate(extraction);
    
    // Add contextual information
    const context = await this.gatherEventContext(extraction);
    
    return {
      ...extraction,
      historicalVerification: verification,
      relatedEvents: historicalMatches,
      additionalContext: context,
      enrichmentConfidence: this.calculateEnrichmentConfidence(verification, historicalMatches)
    };
  }
}
```

## Data Structure Design

### Primary Tuple Schema
```typescript
interface DateTimeTuple {
  id: string;
  eventName: string;
  datetime: Date;
  within: number; // Standard error in days
  
  // Extended dimensions
  eventCategory: string; // historical, personal, natural, etc.
  precision: string; // second, minute, hour, day, month, year, decade, century
  relationship: string; // exact, start, end, during, before, after, approximate
  uncertainty: number; // Range of error in days
  
  // Source and context
  sourceContentId: string;
  extractionTimestamp: Date;
  textEvidence: string; // Original text containing the event-date reference
  context: string; // Surrounding text
  
  // Quality and validation
  confidence: number; // Overall extraction confidence
  validationStatus: 'pending' | 'validated' | 'rejected';
  humanValidated: boolean;
  
  // Historical verification
  historicallyVerified: boolean;
  historicalSources: string[];
  conflictingDates?: Date[]; // If multiple historical dates exist
  
  // Provenance
  extractionMethod: 'pattern_matching' | 'ml_ner' | 'hybrid';
  extractionVersion: string;
  
  // Temporal metadata
  era: 'BCE' | 'CE';
  isApproximate: boolean;
  isRelativeDate: boolean; // e.g., "10 years ago"
  originalDateString: string; // Raw date text from source
  standardErrorCalculation: string; // Method used to calculate standard error
}
```

### Database Schema
```typescript
interface DateTimeDatabase {
  datetimes: {
    [datetimeId: string]: DateTimeTuple;
  };
  
  // Temporal indexes
  datetimesByYear: {
    [year: number]: {
      [datetimeId: string]: boolean;
    };
  };
  
  datetimesByDecade: {
    [decade: number]: {
      [datetimeId: string]: boolean;
    };
  };
  
  datetimesByEvent: {
    [eventName: string]: {
      [datetimeId: string]: boolean;
    };
  };
  
  datetimesByCategory: {
    [category: string]: {
      [datetimeId: string]: boolean;
    };
  };
  
  // Chronological timeline
  chronologicalTimeline: {
    [timestamp: number]: { // Unix timestamp
      events: string[]; // Array of datetimeIds
    };
  };
  
  // Statistics and metadata
  datetimeStats: {
    totalExtractions: number;
    validatedCount: number;
    historicallyVerifiedCount: number;
    averageConfidence: number;
    averageStandardError: number;
    eraDistribution: Record<string, number>;
    categoryDistribution: Record<string, number>;
    precisionDistribution: Record<string, number>;
  };
}
```

## Processing Pipeline Implementation

### Batch Processing System
```typescript
class DateTimeBatchProcessor {
  async processContentBatch(contentIds: string[]): Promise<ProcessingResult> {
    const results: DateTimeTuple[] = [];
    
    for (const contentId of contentIds) {
      try {
        const content = await this.fetchContent(contentId);
        const extractions = await this.extractDateTimeEvents(content);
        
        for (const extraction of extractions) {
          const enriched = await this.enricher.enrichEvent(extraction);
          const validated = await this.validator.validateExtraction(enriched);
          
          if (validated.confidence > 0.6) {
            results.push(validated);
          }
        }
      } catch (error) {
        this.logger.error(`Failed to process content ${contentId}`, error);
      }
    }
    
    await this.storeDateTimeEvents(results);
    await this.updateChronologicalTimeline(results);
    
    return { processed: contentIds.length, extracted: results.length };
  }
  
  private async extractDateTimeEvents(content: Content): Promise<DateTimeExtraction[]> {
    // Extract temporal expressions
    const dateEntities = await this.dateParser.extractDates(content.text);
    
    // Extract event entities
    const eventEntities = await this.eventRecognizer.recognizeEvents(content.text);
    
    // Associate events with dates
    const associations = [];
    for (const eventEntity of eventEntities) {
      const eventAssociations = await this.associator.associateEventWithDateTime(
        eventEntity, dateEntities, content.text
      );
      associations.push(...eventAssociations);
    }
    
    return this.convertToTuples(associations, content);
  }
}
```

### Real-time Processing
```typescript
class DateTimeStreamProcessor {
  async processNewContent(content: Content): Promise<void> {
    const extractions = await this.extractDateTimeEvents(content);
    
    // Store high-confidence extractions immediately
    const highConfidence = extractions.filter(e => e.confidence > 0.8);
    await this.storeDateTimeEvents(highConfidence);
    
    // Update timeline with new events
    await this.updateChronologicalTimeline(highConfidence);
    
    // Queue for historical verification
    const needsVerification = extractions.filter(e => e.confidence > 0.6);
    await this.queueForHistoricalVerification(needsVerification);
  }
}
```

## Quality Assurance & Validation

### Automated Validation
```typescript
class DateTimeValidator {
  async validateExtraction(extraction: DateTimeTuple): Promise<ValidationResult> {
    const checks = await Promise.all([
      this.checkDatePlausibility(extraction),
      this.checkEventConsistency(extraction),
      this.checkHistoricalAccuracy(extraction),
      this.checkTemporalCoherence(extraction)
    ]);
    
    return {
      valid: checks.every(check => check.passed),
      issues: checks.filter(check => !check.passed).map(check => check.issue),
      confidence: this.calculateValidationConfidence(checks)
    };
  }
  
  private async checkHistoricalAccuracy(extraction: DateTimeTuple): Promise<ValidationCheck> {
    if (extraction.eventCategory !== 'historical') {
      return { passed: true, issue: null, confidence: 1.0 };
    }
    
    const historicalEvents = await this.historicalDB.searchEvent(extraction.eventName);
    
    if (historicalEvents.length === 0) {
      return { passed: true, issue: 'Unknown historical event', confidence: 0.5 };
    }
    
    const dateMatches = historicalEvents.some(event => 
      this.isDateWithinTolerance(extraction.datetime, event.startDate, extraction.uncertainty)
    );
    
    return {
      passed: dateMatches,
      issue: dateMatches ? null : `Date conflicts with known historical records`,
      confidence: dateMatches ? 0.9 : 0.2
    };
  }
}
```

## API Design

### Query Interface
```typescript
interface DateTimeQueryAPI {
  // Search events by date range
  searchByDateRange(startDate: Date, endDate: Date, options?: QueryOptions): Promise<DateTimeTuple[]>;
  
  // Search events by name
  searchByEventName(eventName: string, options?: QueryOptions): Promise<DateTimeTuple[]>;
  
  // Get chronological timeline
  getTimeline(startDate: Date, endDate: Date, granularity: 'year' | 'decade' | 'century'): Promise<TimelineEntry[]>;
  
  // Find events around a specific date
  findEventsAroundDate(date: Date, toleranceDays: number): Promise<DateTimeTuple[]>;
  
  // Statistical queries
  getEventStatistics(groupBy: 'category' | 'precision' | 'era'): Promise<Statistics>;
}

// Example usage
const medievalEvents = await datetimeAPI.searchByDateRange(
  new Date(1000, 0, 1), 
  new Date(1500, 0, 1),
  { category: 'historical', minConfidence: 0.8 }
);

const timeline = await datetimeAPI.getTimeline(
  new Date(1940, 0, 1),
  new Date(1950, 0, 1),
  'year'
);
```

### Export Formats
```typescript
interface TimelineExport {
  format: 'csv' | 'json' | 'timeline.js';
  filters: {
    dateRange?: { start: Date; end: Date; };
    categories?: string[];
    minConfidence?: number;
    minMantissa?: number;
  };
  fields: (keyof DateTimeTuple)[];
  chronological: boolean;
}
```

## Files to Create
- `backend/services/datetimeExtractionService.ts`
- `backend/extractors/temporalEntityRecognizer.ts`
- `backend/parsers/flexibleDateParser.ts`
- `backend/estimators/temporalAccuracyEstimator.ts`
- `backend/associators/eventDateTimeAssociator.ts`
- `backend/enrichers/eventEnricher.ts`
- `backend/validators/datetimeValidator.ts`
- `backend/apis/datetimeQueryAPI.ts`
- `backend/types/datetimeTypes.ts`
- `backend/config/datetimeExtractionConfig.ts`

## Success Metrics
- **Extraction Accuracy**: 80%+ precision on manually validated samples
- **Temporal Coverage**: Extract datetime events from 50%+ of historical content
- **Date Accuracy**: Average standard error < 30 days for extracted dates
- **Historical Verification**: 85%+ of historical events match known records
- **Performance**: Process 500+ content items per hour for datetime extraction

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"id": "future-wikipedia-ingestion", "content": "Plan Wikipedia talk pages ingestion system for Aphorist", "status": "completed", "priority": "medium"}, {"id": "future-magnitude-extraction", "content": "Design magnitude/size extraction system: (objectName, magnitude, unit) tuples", "status": "completed", "priority": "medium"}, {"id": "future-datetime-extraction", "content": "Design datetime event extraction system: (eventName, datetime, mantissa) tuples", "status": "completed", "priority": "medium"}, {"id": "plan-derivative-datasets", "content": "Create comprehensive plan for derivative dataset generation from Aphorist content", "status": "completed", "priority": "high"}]