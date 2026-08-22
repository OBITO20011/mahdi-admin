import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NetworkStatusBanner } from '../src/components/NetworkStatusBanner';
import { StoreErrorBoundary } from '../src/components/StoreErrorBoundary';

test('healthy catalog connection does not add a warning banner', () => {
  const markup = renderToStaticMarkup(
    React.createElement(NetworkStatusBanner, {
      isOnline: true,
      refreshError: null,
      lastUpdatedAt: new Date('2026-08-08T12:00:00Z'),
      isRetrying: false,
      onRetry: () => undefined,
    })
  );

  assert.equal(markup, '');
});

test('offline catalog keeps an honest recovery message', () => {
  const markup = renderToStaticMarkup(
    React.createElement(NetworkStatusBanner, {
      isOnline: false,
      refreshError: 'network unavailable',
      lastUpdatedAt: new Date('2026-08-08T12:00:00Z'),
      isRetrying: false,
      onRetry: () => undefined,
    })
  );

  assert.match(markup, /لا يوجد اتصال بالإنترنت حاليًا/);
  assert.match(markup, /نعرض آخر بيانات ناجحة/);
  assert.match(markup, /disabled/);
});

test('unexpected React failures switch to the store recovery screen', () => {
  assert.deepEqual(StoreErrorBoundary.getDerivedStateFromError(), {
    hasError: true,
  });
});
