# Magnitude/Size Extraction System

## Overview
Design and implementation of a natural language processing system to extract magnitude and size references from Aphorist content, generating structured tuples: `(objectName, magnitude, unit, ...metadata)`.

## System Architecture

### Core Components
```typescript
interface MagnitudeExtractionPipeline {
  textProcessor: TextPreprocessor;
  entityRecognizer: MagnitudeEntityRecognizer;
  unitNormalizer: UnitNormalizer;
  contextAnalyzer: ContextAnalyzer;
  validator: MagnitudeValidator;
  storage: MagnitudeDatastore;
}
```

### Data Flow
```
Content Text
     ↓
Text Preprocessing (tokenization, cleaning)
     ↓
Named Entity Recognition (objects, numbers, units)
     ↓
Magnitude Pattern Matching
     ↓
Unit Normalization & Conversion
     ↓
Context Analysis & Validation
     ↓
Structured Tuple Generation
     ↓
Quality Scoring & Storage
```

## Entity Recognition & Pattern Matching

### Magnitude Pattern Detection

#### Regex Patterns for Common Formats
```typescript
const magnitudePatterns = [
  // Basic: "5 meters", "10.5 kg", "3.2 million years"
  /(\d+(?:\.\d+)?)\s*(million|billion|trillion|thousand)?\s*([a-zA-Z]+)/g,
  
  // Range: "5-10 meters", "between 100 and 200 kg"
  /(?:between\s+)?(\d+(?:\.\d+)?)\s*(?:and|to|-)\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g,
  
  // Approximation: "about 5 km", "roughly 100 tons", "~50 meters"
  /(?:about|approximately|roughly|around|~)\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g,
  
  // Scientific notation: "1.5e6 meters", "3.2 × 10^8 m/s"
  /(\d+(?:\.\d+)?)\s*[×x*]\s*10\^?(\d+)\s*([a-zA-Z]+)/g,
  
  // Fractional: "1/2 inch", "3.5/4 miles"
  /(\d+(?:\.\d+)?(?:\/\d+)?)\s*([a-zA-Z]+)/g
];
```

#### Object Recognition Strategies
```typescript
interface ObjectContext {
  entityType: 'physical_object' | 'distance' | 'time' | 'mass' | 'area' | 'volume';
  objectName: string;
  aliases: string[];
  contextKeywords: string[];
}

const objectPatterns = {
  buildings: ['building', 'tower', 'skyscraper', 'bridge', 'cathedral'],
  natural: ['mountain', 'river', 'lake', 'ocean', 'forest', 'desert'],
  animals: ['elephant', 'whale', 'dinosaur', 'bird', 'insect'],
  vehicles: ['car', 'airplane', 'ship', 'rocket', 'train'],
  cosmic: ['planet', 'star', 'galaxy', 'asteroid', 'comet'],
  abstract: ['population', 'distance', 'speed', 'temperature', 'pressure']
};
```

### Unit Recognition & Normalization

#### Unit Categories and Conversion
```typescript
interface UnitDefinition {
  canonical: string;
  category: 'length' | 'mass' | 'time' | 'area' | 'volume' | 'speed' | 'temperature';
  siBase: string;
  conversionFactor: number;
  aliases: string[];
}

const unitDatabase: UnitDefinition[] = [
  // Length
  { canonical: 'meter', category: 'length', siBase: 'm', conversionFactor: 1.0, 
    aliases: ['m', 'meter', 'meters', 'metre', 'metres'] },
  { canonical: 'kilometer', category: 'length', siBase: 'm', conversionFactor: 1000.0,
    aliases: ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'] },
  { canonical: 'foot', category: 'length', siBase: 'm', conversionFactor: 0.3048,
    aliases: ['ft', 'foot', 'feet', "'"] },
  { canonical: 'inch', category: 'length', siBase: 'm', conversionFactor: 0.0254,
    aliases: ['in', 'inch', 'inches', '"'] },
  
  // Mass
  { canonical: 'kilogram', category: 'mass', siBase: 'kg', conversionFactor: 1.0,
    aliases: ['kg', 'kilogram', 'kilograms'] },
  { canonical: 'pound', category: 'mass', siBase: 'kg', conversionFactor: 0.453592,
    aliases: ['lb', 'lbs', 'pound', 'pounds'] },
  { canonical: 'ton', category: 'mass', siBase: 'kg', conversionFactor: 1000.0,
    aliases: ['ton', 'tons', 'tonne', 'tonnes'] },
    
  // Time
  { canonical: 'second', category: 'time', siBase: 's', conversionFactor: 1.0,
    aliases: ['s', 'sec', 'second', 'seconds'] },
  { canonical: 'year', category: 'time', siBase: 's', conversionFactor: 31536000.0,
    aliases: ['yr', 'year', 'years', 'y'] }
];
```

#### Smart Unit Detection
```typescript
class UnitNormalizer {
  normalizeUnit(rawUnit: string, context: string): NormalizedUnit {
    // Handle common abbreviations and misspellings
    const cleaned = this.cleanUnit(rawUnit);
    
    // Use context to disambiguate (e.g., "m" could be meter or minute)
    const candidates = this.findUnitCandidates(cleaned);
    
    if (candidates.length > 1) {
      return this.disambiguateWithContext(candidates, context);
    }
    
    return candidates[0] || this.createUnknownUnit(rawUnit);
  }
  
  private disambiguateWithContext(candidates: UnitDefinition[], context: string): UnitDefinition {
    // Use surrounding words to determine likely unit
    // e.g., "traveled 5 m" vs "lasted 5 m" (meters vs minutes)
    const contextKeywords = this.extractContextKeywords(context);
    return this.scoreCandidates(candidates, contextKeywords);
  }
}
```

## Advanced Extraction Techniques

### Machine Learning Integration

#### Named Entity Recognition Model
```typescript
interface MagnitudeNERModel {
  recognizeEntities(text: string): Promise<EntitySpan[]>;
  classifyMagnitudeType(entity: EntitySpan): MagnitudeType;
  extractRelationships(entities: EntitySpan[]): ObjectMagnitudeRelation[];
}

interface EntitySpan {
  text: string;
  start: number;
  end: number;
  type: 'OBJECT' | 'MAGNITUDE' | 'UNIT' | 'QUALIFIER';
  confidence: number;
}
```

#### Training Data Generation
```typescript
// Generate training examples from Wikipedia, scientific papers
const trainingExamples = [
  {
    text: "The Empire State Building is 381 meters tall",
    labels: [
      { start: 4, end: 23, type: 'OBJECT', text: 'Empire State Building' },
      { start: 27, end: 30, type: 'MAGNITUDE', text: '381' },
      { start: 31, end: 37, type: 'UNIT', text: 'meters' },
      { start: 38, end: 42, type: 'QUALIFIER', text: 'tall' }
    ]
  }
];
```

### Context-Aware Extraction

#### Relationship Detection
```typescript
interface MagnitudeRelationship {
  object: string;
  magnitude: number;
  unit: string;
  dimension: 'length' | 'width' | 'height' | 'depth' | 'mass' | 'age' | 'speed';
  qualifier?: string; // "tall", "wide", "heavy", "old"
  context: string; // surrounding sentence
  confidence: number;
}

class ContextAnalyzer {
  analyzeMagnitudeContext(text: string, magnitudeSpan: EntitySpan): MagnitudeRelationship {
    const sentence = this.extractSentence(text, magnitudeSpan);
    const objects = this.findNearbyObjects(sentence, magnitudeSpan);
    const dimension = this.inferDimension(sentence, magnitudeSpan);
    
    return {
      object: objects[0]?.text || 'unknown',
      magnitude: parseFloat(magnitudeSpan.text),
      unit: this.extractUnit(sentence, magnitudeSpan),
      dimension,
      qualifier: this.extractQualifier(sentence, magnitudeSpan),
      context: sentence,
      confidence: this.calculateConfidence(sentence, magnitudeSpan)
    };
  }
}
```

### Confidence Scoring

#### Multi-Factor Confidence Model
```typescript
interface ConfidenceFactors {
  entityRecognitionScore: number; // NER model confidence
  unitValidityScore: number; // Known unit vs unknown
  contextCoherenceScore: number; // Does the magnitude make sense?
  grammarValidityScore: number; // Grammatically correct extraction
  domainPlausibilityScore: number; // Realistic magnitude for object type
}

class ConfidenceScorer {
  calculateOverallConfidence(factors: ConfidenceFactors): number {
    const weights = {
      entityRecognition: 0.3,
      unitValidity: 0.2,
      contextCoherence: 0.2,
      grammarValidity: 0.15,
      domainPlausibility: 0.15
    };
    
    return Object.entries(weights).reduce((score, [factor, weight]) => {
      return score + (factors[factor as keyof ConfidenceFactors] * weight);
    }, 0);
  }
  
  assessDomainPlausibility(object: string, magnitude: number, unit: string): number {
    const ranges = this.getTypicalRanges(object, unit);
    if (!ranges) return 0.5; // Unknown object, neutral score
    
    const normalizedMag = this.normalizeToBaseUnit(magnitude, unit);
    return this.calculateRangePlausibility(normalizedMag, ranges);
  }
}
```

## Data Structure Design

### Primary Tuple Schema
```typescript
interface MagnitudeTuple {
  id: string;
  objectName: string;
  magnitude: number;
  unit: string;
  unitCanonical: string; // Normalized unit
  dimension: string; // height, width, mass, etc.
  
  // Extended dimensions
  sourceContentId: string; // Reference to original post/reply
  extractionTimestamp: Date;
  confidence: number;
  context: string; // Surrounding text
  
  // Normalization
  magnitudeNormalized: number; // Converted to SI base unit
  unitCategory: string; // length, mass, time, etc.
  
  // Quality and validation
  validationStatus: 'pending' | 'validated' | 'rejected';
  humanValidated: boolean;
  validationNotes?: string;
  
  // Provenance
  extractionMethod: 'regex' | 'ml_ner' | 'hybrid';
  extractionVersion: string;
}
```

### Database Schema
```typescript
// RTDB structure for magnitude data
interface MagnitudeDatabase {
  magnitudes: {
    [magnitudeId: string]: MagnitudeTuple;
  };
  
  // Indexes for efficient querying
  magnitudesByObject: {
    [objectName: string]: {
      [magnitudeId: string]: boolean;
    };
  };
  
  magnitudesByUnit: {
    [unitCategory: string]: {
      [magnitudeId: string]: boolean;
    };
  };
  
  magnitudesBySource: {
    [sourceContentId: string]: {
      [magnitudeId: string]: boolean;
    };
  };
  
  // Aggregate statistics
  magnitudeStats: {
    totalExtractions: number;
    validatedCount: number;
    averageConfidence: number;
    unitCategoryCounts: Record<string, number>;
    lastProcessedContent: string;
  };
}
```

## Processing Pipeline Implementation

### Batch Processing System
```typescript
class MagnitudeBatchProcessor {
  async processContentBatch(contentIds: string[]): Promise<ProcessingResult> {
    const results: MagnitudeTuple[] = [];
    
    for (const contentId of contentIds) {
      try {
        const content = await this.fetchContent(contentId);
        const extractions = await this.extractMagnitudes(content);
        
        for (const extraction of extractions) {
          const validated = await this.validateExtraction(extraction);
          if (validated.confidence > 0.7) {
            results.push(validated);
          }
        }
      } catch (error) {
        this.logger.error(`Failed to process content ${contentId}`, error);
      }
    }
    
    await this.storeMagnitudes(results);
    return { processed: contentIds.length, extracted: results.length };
  }
  
  private async extractMagnitudes(content: Content): Promise<MagnitudeTuple[]> {
    // Run multiple extraction methods and combine results
    const regexResults = await this.regexExtractor.extract(content.text);
    const mlResults = await this.mlExtractor.extract(content.text);
    
    // Merge and deduplicate results
    return this.mergeExtractions(regexResults, mlResults, content);
  }
}
```

### Real-time Processing
```typescript
class MagnitudeStreamProcessor {
  async processNewContent(content: Content): Promise<void> {
    // Extract magnitudes from new posts/replies as they're created
    const extractions = await this.extractMagnitudes(content);
    
    // Store high-confidence extractions immediately
    const highConfidence = extractions.filter(e => e.confidence > 0.8);
    await this.storeMagnitudes(highConfidence);
    
    // Queue lower-confidence extractions for manual review
    const needsReview = extractions.filter(e => e.confidence > 0.5 && e.confidence <= 0.8);
    await this.queueForReview(needsReview);
  }
}
```

## Quality Assurance & Validation

### Automated Validation
```typescript
class MagnitudeValidator {
  async validateExtraction(extraction: MagnitudeTuple): Promise<ValidationResult> {
    const checks = await Promise.all([
      this.checkUnitConsistency(extraction),
      this.checkMagnitudePlausibility(extraction),
      this.checkContextCoherence(extraction),
      this.checkDuplicates(extraction)
    ]);
    
    return {
      valid: checks.every(check => check.passed),
      issues: checks.filter(check => !check.passed).map(check => check.issue),
      confidence: this.calculateValidationConfidence(checks)
    };
  }
  
  private async checkMagnitudePlausibility(extraction: MagnitudeTuple): Promise<ValidationCheck> {
    const typicalRanges = await this.getTypicalRanges(extraction.objectName, extraction.unitCategory);
    
    if (!typicalRanges) {
      return { passed: true, issue: null, confidence: 0.5 };
    }
    
    const inRange = this.isWithinReasonableRange(extraction.magnitudeNormalized, typicalRanges);
    return {
      passed: inRange,
      issue: inRange ? null : `Magnitude ${extraction.magnitude} ${extraction.unit} seems unusual for ${extraction.objectName}`,
      confidence: inRange ? 0.9 : 0.3
    };
  }
}
```

### Human Validation Interface
```typescript
interface ValidationUI {
  displayExtraction(extraction: MagnitudeTuple): void;
  collectUserFeedback(): ValidationFeedback;
  updateExtractionStatus(id: string, status: ValidationStatus): void;
}

interface ValidationFeedback {
  isCorrect: boolean;
  correctedObject?: string;
  correctedMagnitude?: number;
  correctedUnit?: string;
  notes?: string;
}
```

## API Design

### Query Interface
```typescript
interface MagnitudeQueryAPI {
  // Find magnitudes for specific objects
  searchByObject(objectName: string, options?: QueryOptions): Promise<MagnitudeTuple[]>;
  
  // Find objects within magnitude ranges
  searchByMagnitudeRange(unit: string, min: number, max: number): Promise<MagnitudeTuple[]>;
  
  // Compare objects by magnitude
  compareObjects(objects: string[], dimension: string): Promise<ComparisonResult>;
  
  // Statistical aggregations
  getStatistics(groupBy: 'object' | 'unit' | 'dimension'): Promise<Statistics>;
}

// Example usage
const buildingHeights = await magnitudeAPI.searchByObject('building', {
  dimension: 'height',
  unit: 'meter',
  minConfidence: 0.8
});

const tallBuildings = await magnitudeAPI.searchByMagnitudeRange('meter', 300, 1000);
```

### Export Formats
```typescript
interface DatasetExport {
  format: 'csv' | 'json' | 'parquet';
  filters: {
    minConfidence?: number;
    objectTypes?: string[];
    unitCategories?: string[];
    dateRange?: { start: Date; end: Date; };
  };
  fields: (keyof MagnitudeTuple)[];
}

// Export API
const dataset = await magnitudeAPI.exportDataset({
  format: 'csv',
  filters: { minConfidence: 0.8, unitCategories: ['length', 'mass'] },
  fields: ['objectName', 'magnitude', 'unit', 'confidence', 'sourceContentId']
});
```

## Files to Create
- `backend/services/magnitudeExtractionService.ts`
- `backend/extractors/magnitudeRegexExtractor.ts`
- `backend/extractors/magnitudeMLExtractor.ts`
- `backend/normalizers/unitNormalizer.ts`
- `backend/validators/magnitudeValidator.ts`
- `backend/apis/magnitudeQueryAPI.ts`
- `backend/types/magnitudeTypes.ts`
- `backend/config/magnitudeExtractionConfig.ts`

## Success Metrics
- **Extraction Accuracy**: 85%+ precision on manually validated samples
- **Coverage**: Extract magnitudes from 60%+ of content containing measurements
- **Performance**: Process 1000+ content items per hour
- **Data Quality**: 90%+ of extractions pass automated validation
- **API Usage**: Support 100+ queries per second for magnitude search