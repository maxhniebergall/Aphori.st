# Future Features: Wikipedia Ingestion & Derivative Datasets

## Overview
Post-vector search implementation, Aphorist will expand to include Wikipedia talk page content and generate structured derivative datasets for magnitude/size references and datetime events.

## Feature Categories

### 1. Wikipedia Talk Page Ingestion
**File:** `wikipedia_ingestion.md`
- Data source integration and parsing
- Content transformation for Aphorist format
- Bulk import infrastructure
- Incremental update mechanisms

### 2. Magnitude/Size Extraction System
**File:** `magnitude_extraction.md`
- Natural language processing for size/magnitude identification
- Tuple generation: `(objectName, magnitude, unit)`
- Unit standardization and conversion
- Confidence scoring and validation

### 3. DateTime Event Extraction System  
**File:** `datetime_extraction.md`
- Temporal entity recognition and extraction
- Tuple generation: `(eventName, datetime, within)`
- Date accuracy modeling with standard error estimation
- Historical event correlation

### 4. Derivative Dataset Infrastructure
**File:** `dataset_infrastructure.md`
- Data pipeline architecture for continuous extraction
- Storage and indexing for structured datasets
- API endpoints for dataset access
- Quality assurance and monitoring

## Implementation Timeline
- **Phase 1** (Month 1-2): Wikipedia ingestion infrastructure
- **Phase 2** (Month 2-3): Magnitude extraction system
- **Phase 3** (Month 3-4): DateTime extraction system  
- **Phase 4** (Month 4-5): Dataset infrastructure and APIs
- **Phase 5** (Month 5-6): Integration, testing, and optimization

## Dependencies
- Vector search system must be stable and deployed
- Content creation and storage infrastructure proven at scale
- Natural language processing capabilities (NER, entity extraction)
- Data pipeline infrastructure for bulk processing

## Strategic Value
- **Research Applications**: Structured knowledge extraction from discussions
- **Data Products**: Novel datasets for academic and commercial use
- **Platform Differentiation**: Unique structured data generation capabilities
- **Monetization**: Potential dataset licensing opportunities