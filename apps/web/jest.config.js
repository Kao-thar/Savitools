const transform = {
  '^.+\\.(ts|tsx)$': [
    'ts-jest',
    {
      tsconfig: {
        jsx: 'react-jsx',
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowJs: true,
        // ts-jest rewrites `sources` in its inline maps to `file://` URLs, and
        // babel-plugin-istanbul then keeps those URLs as coverage paths. That
        // turns into `src/lib/file:/...` entries whose report directories are
        // named `file:` (with a colon), which `actions/upload-artifact` refuses
        // to archive. Emitting no map keeps coverage keys on plain file paths.
        sourceMap: false,
      },
    },
  ],
};

const shared = {
  rootDir: __dirname,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform,
};

module.exports = {
  // `.tsx` matters: every React component and route page test is JSX. Both
  // suffixes are collected because the repo already carries `.test.ts` and
  // `.spec.ts(x)` files — anything else silently never runs.
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/**/__tests__/**'],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  // A ratchet floor, not a target: it is pinned just under the coverage this
  // suite already measures so the gate can never drift down. It should only
  // ever be raised as component and route coverage lands.
  coverageThreshold: {
    global: {
      branches: 3.5,
      functions: 3.5,
      lines: 7.5,
      statements: 7,
    },
  },
  projects: [
    {
      // Pure logic suites: fuzzy search, recent items, preferences, contracts.
      ...shared,
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/__tests__/**/*.{test,spec}.ts'],
    },
    {
      // Component suites: anything that needs to mount React into a DOM.
      ...shared,
      displayName: 'dom',
      testEnvironment: 'jsdom',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.dom.ts'],
      testMatch: ['<rootDir>/src/__tests__/**/*.{test,spec}.tsx'],
    },
  ],
};
