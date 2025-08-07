
      import { parentPort } from 'worker_threads';
      import { SpellCheckService } from './dist/SpellCheckService.js';

      function isWordSuitableForThemes(word) {
        if (!word || typeof word !== 'string') return false;
        
        const cleaned = word.toLowerCase().trim();
        
        if (cleaned.length < 3 || cleaned.length > 15) return false;
        if (!/^[a-z]+$/.test(cleaned)) return false;
        
        const excludeWords = new Set([
          'sex', 'porn', 'nude', 'naked', 'xxx', 'gay', 'lesbian', 'anal', 'oral', 'pussy', 'cum',
          'rape', 'incest', 'fuck', 'fucking', 'shit', 'ass', 'milf', 'mature', 'hardcore',
          'drug', 'kill', 'death', 'hate', 'racist', 'nazi', 'dead'
        ]);
        
        if (excludeWords.has(cleaned)) return false;
        
        if (cleaned.length <= 3 && /^[a-z]{1,3}$/.test(cleaned)) {
          const allowedShort = new Set(['the', 'and', 'you', 'are', 'for', 'can', 'not', 'but', 'all', 'get', 'has', 'had', 'him', 'her', 'how', 'man', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'car', 'day', 'eye', 'far', 'got', 'run', 'sat', 'sun', 'top', 'try', 'win', 'yes', 'yet', 'ago', 'air', 'ask', 'bad', 'bag', 'bar', 'bed', 'big', 'bit', 'box', 'boy', 'bus', 'buy', 'car', 'cat', 'cup', 'cut', 'die', 'dog', 'eat', 'end', 'eye', 'far', 'few', 'fit', 'fly', 'fun', 'gas', 'god', 'got', 'gun', 'guy', 'hit', 'hot', 'ice', 'job', 'key', 'kid', 'law', 'lay', 'leg', 'let', 'lie', 'lot', 'low', 'man', 'map', 'may', 'mom', 'net', 'new', 'nor', 'not', 'now', 'odd', 'off', 'oil', 'old', 'one', 'our', 'out', 'own', 'pay', 'per', 'put', 'raw', 'red', 'run', 'sad', 'sat', 'say', 'sea', 'see', 'set', 'she', 'sit', 'six', 'sky', 'son', 'sun', 'tax', 'ten', 'the', 'tie', 'tip', 'too', 'top', 'try', 'two', 'use', 'van', 'war', 'was', 'way', 'web', 'who', 'why', 'win', 'won', 'yes', 'yet', 'you', 'zoo']);
          return allowedShort.has(cleaned);
        }
        
        return true;
      }

      async function processVocabChunk(workerId, chunk) {
        try {
          const spellCheckService = new SpellCheckService();
          await spellCheckService.initialize();
          
          const processedMappings = new Map();
          let errorCount = 0;
          let processedCount = 0;
          
          for (const {index, word} of chunk.words) {
            try {
              const cleanWord = word.toLowerCase().trim();
              if (!isWordSuitableForThemes(cleanWord)) {
                processedCount++;
                continue;
              }
              
              const canonicalForm = spellCheckService.getCanonicalForm(cleanWord);
              
              if (!isWordSuitableForThemes(canonicalForm)) {
                processedCount++;
                continue;
              }
              
              if (processedMappings.has(canonicalForm)) {
                const existing = processedMappings.get(canonicalForm);
                existing.originalIndices.push(index);
                if (!existing.originalWords.includes(cleanWord)) {
                  existing.originalWords.push(cleanWord);
                }
              } else {
                processedMappings.set(canonicalForm, {
                  canonicalForm,
                  originalIndices: [index],
                  originalWords: [cleanWord]
                });
              }
              
              processedCount++;
              
              if (processedCount % 1000 === 0) {
                parentPort.postMessage({
                  type: 'progress',
                  workerId,
                  processed: processedCount,
                  total: chunk.words.length
                });
              }
              
            } catch (error) {
              errorCount++;
            }
          }
          
          const resultArray = Array.from(processedMappings.values());
          
          parentPort.postMessage({
            type: 'complete',
            result: {
              workerId,
              processedMappings: resultArray,
              errorCount
            }
          });
          
        } catch (error) {
          parentPort.postMessage({
            type: 'error',
            error: error.message
          });
        }
      }

      parentPort.on('message', (data) => {
        if (data.type === 'start') {
          processVocabChunk(data.workerId, data.chunk);
        }
      });
    