import test from 'node:test';
import assert from 'node:assert/strict';
import {migrationManifest} from '../scripts/testing/maintenance-db-contract.mjs';
import {reviewed220CatalogManifest} from '../scripts/testing/literal220-catalog-manifest.mjs';
test('actual220 capture admits its exact181-file prefix only after validating the complete226 source,including unchanged222/223/224/225',async()=>{
 const current=await migrationManifest(process.cwd()),prefix=reviewed220CatalogManifest(current);
 assert.equal(current.length,186);assert.equal(current.at(-1)!.name,'226_parcel_price_integrity.sql');
 assert.equal(prefix.length,181);assert.equal(prefix.at(-1)!.name,'220_sales_only_operating_mode.sql');
 assert.deepEqual(prefix.map(m=>m.name),current.slice(0,-5).map(m=>m.name));
 assert.throws(()=>reviewed220CatalogManifest(prefix),'Cannot silently slice an unvalidated preceding source');
 assert.throws(()=>reviewed220CatalogManifest(current.map((m,i)=>i===181?{...m,sha256:'0'.repeat(64)}:m)),'Even222 outside the220 prefix must retain its full reviewed hash');
 assert.throws(()=>reviewed220CatalogManifest(current.map((m,i)=>i===182?{...m,sha256:'0'.repeat(64)}:m)),'Even223 outside the220 prefix must retain its full reviewed hash');
 assert.throws(()=>reviewed220CatalogManifest(current.map((m,i)=>i===183?{...m,sha256:'0'.repeat(64)}:m)),'Even224 outside220 stays exact');
 assert.throws(()=>reviewed220CatalogManifest(current.map((m,i)=>i===184?{...m,sha256:'0'.repeat(64)}:m)),'The new225 migration must also retain its exact hash');
 assert.throws(()=>reviewed220CatalogManifest(current.map((m,i)=>i===185?{...m,sha256:'0'.repeat(64)}:m)),'The exact226 migration is required');
 assert.throws(()=>reviewed220CatalogManifest([...current,{name:'227_unknown.sql',sha256:'a'.repeat(64)}]));
 assert.throws(()=>reviewed220CatalogManifest([...prefix,{name:'221_reserved_accounting.sql',sha256:'a'.repeat(64)},current.at(-1)!]));
 assert.throws(()=>reviewed220CatalogManifest(current.map((m,i)=>i===0?{...m,sha256:'0'.repeat(64)}:m)));
});
