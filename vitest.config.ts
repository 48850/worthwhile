// Unit tests for /core (and the contracts it enforces): `npm test`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  define: {
    __DEV__: 'false',
  },
});
