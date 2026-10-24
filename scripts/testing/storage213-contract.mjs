import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createClient} from '@supabase/supabase-js';
export async function storage213Contract({api,status,client,ownerSession,ownerId,sql,q}){
 assert.ok(['127.0.0.1','localhost'].includes(new URL(api).hostname));
 const make=()=>createClient(api,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),anon=make(),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC4sAAAAASUVORK5CYII=','base64'),proof=[];
 for(const role of ['owner','admin','manager','warehouse_keeper','cashier','none']){
  console.log(JSON.stringify({stage:'storage213-role',role}));
  let session=ownerSession,uid=ownerId;
  if(role!=='owner'){
   const email='storage213-'+role+'@example.test',password=randomUUID()+'aA1!';const created=await client.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null,role+':create-user');uid=created.data.user.id;
   await sql(`INSERT INTO profiles(id,full_name,is_active) VALUES(${q(uid)},'Storage213',true);${role==='none'?'':`INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;INSERT INTO user_roles(user_id,role_id) SELECT ${q(uid)},id FROM roles WHERE code=${q(role)};`}`);
   session=make();const link=await client.auth.admin.generateLink({type:'magiclink',email});assert.equal(link.error,null,role+':local-otp-link');assert.equal((await session.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'email'})).error,null,role+':local-otp-session');
  }
  const object=uid+'/security213.png',bucket=session.storage.from('product-images'),allowed=['owner','admin','manager','warehouse_keeper'].includes(role),uploaded=await bucket.upload(object,bytes,{contentType:'image/png'});
  if(allowed){
   assert.equal(uploaded.error,null,role+':upload');assert.equal((await bucket.upload(object,bytes,{contentType:'image/png',upsert:true})).error,null,role+':upsert');
   const own=await bucket.list(uid);assert.equal(own.error,null,role+':own-list');assert.ok(own.data.some(r=>r.name==='security213.png'),role+':own-object-visible');
   assert.ok((await bucket.upload('unowned/security213.png',bytes,{contentType:'image/png'})).error,role+':cross-folder-denied');
   const publicUrl=bucket.getPublicUrl(object).data.publicUrl;const response=await fetch(publicUrl);assert.equal(response.status,200,role+':public-image-status');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes,role+':public-image-bytes');
   for(const prefix of ['',uid]){const listing=await anon.storage.from('product-images').list(prefix,{search:'security213'});assert.equal(listing.error,null,role+':anon-list-dispatch');assert.deepEqual(listing.data,[],role+':ANON_MUST_NOT_LEARN_FILENAMES');}
   assert.equal((await bucket.remove([object])).error,null,role+':delete');proof.push({role,upload:true,upsert:true,ownMetadata:true,crossFolderDenied:true,publicImageBytes:true,anonymousListingEmpty:true,delete:true});
  }else{assert.ok(uploaded.error,role+':upload-denied');assert.deepEqual((await bucket.list(ownerId)).data,[]);proof.push({role,uploadDenied:true,listingEmpty:true});}
  if(session!==ownerSession)await session.auth.signOut();
 }
 assert.ok((await anon.storage.from('product-images').upload('anonymous/security213.png',bytes,{contentType:'image/png'})).error);
 return {ok:true,actualStorageHttp:true,anonymousListing:'RLS returns an empty array without names',anonymousUploadDenied:true,roles:proof};
}
