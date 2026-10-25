// S3 transport boundary fixture: no network or SDK endpoint is constructed.
export function localR2Fixture(){
  const objects=new Map(),calls=[];
  const missing=()=>Object.assign(new Error('NotFound'),{$metadata:{httpStatusCode:404}});
  const conflict=()=>Object.assign(new Error('PreconditionFailed'),{$metadata:{httpStatusCode:412}});
  return {objects,calls,client:{async send(command){
    const name=command.constructor.name,input=command.input;calls.push({name,key:input.Key??input.Prefix});
    if(name==='HeadObjectCommand'){const item=objects.get(input.Key);if(!item)throw missing();return {ContentLength:item.bytes.length,Metadata:item.metadata};}
    if(name==='PutObjectCommand'){
      if(objects.has(input.Key)&&input.IfNoneMatch==='*')throw conflict();
      const chunks=[];if(typeof input.Body==='string')chunks.push(Buffer.from(input.Body));else for await(const chunk of input.Body)chunks.push(Buffer.from(chunk));
      objects.set(input.Key,{bytes:Buffer.concat(chunks),metadata:input.Metadata,modified:new Date()});return {};
    }
    if(name==='ListObjectsV2Command')return {Contents:[...objects].filter(([key])=>key.startsWith(input.Prefix??'')).map(([Key,item])=>({Key,Size:item.bytes.length,LastModified:item.modified}))};
    if(name==='GetObjectCommand'){const item=objects.get(input.Key);if(!item)throw missing();return {ContentLength:item.bytes.length,Metadata:item.metadata,Body:{transformToString:async()=>item.bytes.toString('utf8'),transformToWebStream:()=>new Blob([item.bytes]).stream()}};}
    throw new Error('UNEXPECTED_S3_OPERATION:'+name);
  }}};
}
