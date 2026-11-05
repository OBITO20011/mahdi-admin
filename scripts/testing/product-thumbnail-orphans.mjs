// Exact physical pairs only; a suffix alone never makes an orphan legitimate.
import assert from 'node:assert/strict';
export function classifyProductImageObjects(objects, imageUrls, publicPrefix) {
  assert.ok(publicPrefix.endsWith('/'));
  const names=new Set(objects.map(object=>object.name)),references=new Set(imageUrls);
  const originals=[],thumbnails=[],orphans=[];
  for(const object of objects){
    if(references.has(publicPrefix+object.name)){originals.push(object.name);continue;}
    const suffix='-400.webp',original=object.name.endsWith(suffix)?object.name.slice(0,-suffix.length):'';
    if(original&&names.has(original)&&references.has(publicPrefix+original)&&object.mimetype==='image/webp')thumbnails.push(object.name);
    else orphans.push(object.name);
  }
  return{originals,thumbnails,orphans};
}
