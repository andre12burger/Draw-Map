import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.js'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['public/js/core/**/*.js', 'public/js/map/distance.js', 'public/js/export/**/*.js'],
      exclude: ['public/js/core/events.js'],
    },
  },
});
