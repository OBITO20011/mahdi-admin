import assert from 'node:assert/strict';
import test from 'node:test';
import {productThumbnailPath, createProductThumbnail} from '../src/utils/productImageThumbnail';
import {productThumbnailUrl} from '../customer-web/src/utils/productThumbnail';
test('thumbnail path derives from the immutable original without changing identifiers or query secrets', async () => {
  const path = 'owner/categories/unique.png';
  assert.equal(productThumbnailPath(path), path + '-400.webp');
  assert.equal(productThumbnailUrl('https://example.test/storage/a%20b.JPG'), 'https://example.test/storage/a%20b.JPG-400.webp');
  for (const original of ['data:image/png;base64,abc', 'blob:https://example.test/abc', '/a.jpg', 'https://example.test/a.jpg?token=private', 'https://example.test/a.jpg#private', 'https://user:pass@example.test/a.jpg', 'https://example.test/a.svg']) assert.equal(productThumbnailUrl(original), original);
  assert.equal(await createProductThumbnail(new File(['node-only'], 'fixture.jpg', {type: 'image/jpeg'})), null);
});
