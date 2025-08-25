// Type declarations for external modules

declare module 'nspell' {
  interface NSpellInstance {
    correct(word: string): boolean;
    suggest(word: string): string[];
  }

  function nspell(dictionary: any): NSpellInstance;
  export = nspell;
}

declare module 'dictionary-en-us' {
  interface DictionaryData {
    aff: Buffer;
    dic: Buffer;
  }

  function dictionary(callback: (error: Error | null, data?: DictionaryData) => void): void;
  export = dictionary;
}

declare module 'wink-lemmatizer' {
  export function noun(word: string): string;
  export function verb(word: string): string;
  export function adjective(word: string): string;
  export function lemmatizeNoun(word: string): string;
  export function lemmatizeVerb(word: string): string;
  export function lemmatizeAdjective(word: string): string;
}