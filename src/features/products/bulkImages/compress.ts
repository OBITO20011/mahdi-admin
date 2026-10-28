import {validateProductImage} from '../../../utils/productImage';
import type {PreparedImage} from './model';

export const BULK_IMAGE_MAX_SIDE=1200;
export const BULK_IMAGE_TARGET_BYTES=300_000;
const encode=(canvas:HTMLCanvasElement,quality:number)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('تعذر تجهيز الصورة.')),'image/jpeg',quality));

/** Both decoders honor EXIF;canvas output has upright pixels and no EXIF rotation. */
export async function compressProductImage(file:File):Promise<PreparedImage>{
 const validation=validateProductImage(file);if(validation)throw new Error(validation);
 const canvas=document.createElement('canvas'),thumb=document.createElement('canvas');
 let source:ImageBitmap|HTMLImageElement|undefined,url:string|undefined;
 try{
  const bytes=await file.arrayBuffer();
  const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(typeof createImageBitmap==='function')source=await createImageBitmap(file,{imageOrientation:'from-image'});
  else{url=URL.createObjectURL(file);const image=new Image();image.src=url;await image.decode();source=image;}
  const originalWidth=source instanceof HTMLImageElement?source.naturalWidth:source.width;
  const originalHeight=source instanceof HTMLImageElement?source.naturalHeight:source.height;
  if(!originalWidth||!originalHeight)throw new Error('INVALID_IMAGE');
  const ratio=Math.min(1,BULK_IMAGE_MAX_SIDE/Math.max(originalWidth,originalHeight));
  canvas.width=Math.max(1,Math.round(originalWidth*ratio));canvas.height=Math.max(1,Math.round(originalHeight*ratio));
  const context=canvas.getContext('2d');if(!context)throw new Error('CANVAS_UNAVAILABLE');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(source,0,0,canvas.width,canvas.height);
  let blob=await encode(canvas,0.88);
  for(const quality of [0.78,0.66,0.54,0.42]){if(blob.size<BULK_IMAGE_TARGET_BYTES)break;blob=await encode(canvas,quality);}
  while(blob.size>=BULK_IMAGE_TARGET_BYTES&&Math.max(canvas.width,canvas.height)>240){
   const smaller=document.createElement('canvas');smaller.width=Math.max(1,Math.floor(canvas.width*0.8));smaller.height=Math.max(1,Math.floor(canvas.height*0.8));
   const smallContext=smaller.getContext('2d');if(!smallContext)throw new Error('CANVAS_UNAVAILABLE');smallContext.drawImage(canvas,0,0,smaller.width,smaller.height);
   canvas.width=smaller.width;canvas.height=smaller.height;context.drawImage(smaller,0,0);smaller.width=0;smaller.height=0;blob=await encode(canvas,0.78);
  }
  if(blob.size>=BULK_IMAGE_TARGET_BYTES)throw new Error('IMAGE_TOO_LARGE');
  const thumbRatio=Math.min(1,96/Math.max(canvas.width,canvas.height));thumb.width=Math.max(1,Math.round(canvas.width*thumbRatio));thumb.height=Math.max(1,Math.round(canvas.height*thumbRatio));
  const thumbContext=thumb.getContext('2d');if(!thumbContext)throw new Error('CANVAS_UNAVAILABLE');thumbContext.drawImage(canvas,0,0,thumb.width,thumb.height);
  const thumbnail=await encode(thumb,0.75);
  return {file:new File([blob],file.name.replace(/\.[^.]+$/u,'.jpg'),{type:'image/jpeg',lastModified:file.lastModified}),fingerprint,thumbnail,width:canvas.width,height:canvas.height};
 }catch(error){
  if(error instanceof Error&&error.message==='IMAGE_TOO_LARGE')throw new Error('تعذر ضغط الصورة إلى أقل من 300KB؛ اختر صورة أصغر.',{cause:error});
  throw new Error('ملف الصورة تالف أو تعذر قراءته. اختر صورة JPG أو PNG أو WebP سليمة.',{cause:error});
 }finally{if(source&&'close' in source)source.close();if(url)URL.revokeObjectURL(url);canvas.width=0;canvas.height=0;thumb.width=0;thumb.height=0;}
}
