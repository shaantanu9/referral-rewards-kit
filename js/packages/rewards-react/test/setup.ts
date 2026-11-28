// Unmounts what each test rendered (vitest runs without globals, so Testing Library cannot register it itself).
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
