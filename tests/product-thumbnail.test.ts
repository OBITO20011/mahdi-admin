import {classifyProductImageObjects} from '../scripts/testing/product-thumbnail-orphans.mjs';
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

test('orphan protection accepts only an existing referenced original plus its exact WebP pair', () => {
  const prefix='http://127.0.0.1/storage/',objects=[{name:'owner/a.jpg',mimetype:'image/jpeg'},{name:'owner/a.jpg-400.webp',mimetype:'image/webp'}];
  assert.deepEqual(classifyProductImageObjects(objects,[prefix+'owner/a.jpg'],prefix),{originals:['owner/a.jpg'],thumbnails:['owner/a.jpg-400.webp'],orphans:[]});
  assert.deepEqual(classifyProductImageObjects(objects,[],prefix).orphans,objects.map(object=>object.name));
  assert.deepEqual(classifyProductImageObjects(objects.slice(1),[prefix+'owner/a.jpg'],prefix).orphans,['owner/a.jpg-400.webp']);
  assert.deepEqual(classifyProductImageObjects([objects[0],{...objects[1],mimetype:'image/png'}],[prefix+'owner/a.jpg'],prefix).orphans,['owner/a.jpg-400.webp']);
  assert.deepEqual(classifyProductImageObjects([...objects,{name:'owner/b.jpg-400.webp',mimetype:'image/webp'}],[prefix+'owner/a.jpg'],prefix).orphans,['owner/b.jpg-400.webp']);
});
