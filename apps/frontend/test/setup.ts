import { afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';

// Unmount every component after its test, so pending work (e.g. a debounced auto-save) of one
// test can never reach the next test's mocks.
enableAutoUnmount(afterEach);
