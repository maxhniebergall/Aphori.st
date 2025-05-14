/** @type {import('ts-jest').JestConfigWithTsEsm} */
export default {
    preset: 'ts-jest/presets/default-esm',
    transform: {
        // Use ts-jest for .ts and .tsx files
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                useESM: true,
                // other ts-jest specific options can go here
            },
        ],
    },
    moduleNameMapper: {
        '^(\\.\\.?/.+)\\.js$': '$1'
    },
    testEnvironment: 'node',
    rootDir: '.',
    clearMocks: true,
    roots: [
        '<rootDir>'
    ],
    testMatch: [
        '**/__tests__/**/*.test.ts',
    ],
    // globals: { // This section is deprecated for ts-jest config
    //   'ts-jest': {
    //     useESM: true,
    //   }
    // }
    globalSetup: './jest.globalSetup.js', // Adjust path if needed
    globalTeardown: './jest.globalTeardown.js', // Adjust path if needed

};