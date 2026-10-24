import {PHOTO_POLICY} from './photo-policy';
export async function compressPhoto(file:File,maxBytes=PHOTO_POLICY.maxOutputBytes):Promise<File>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('استخدم صورة JPG أو PNG أو WebP');
 if(file.size>PHOTO_POLICY.maxInputBytes)throw Error('الصورة الأصلية لازم تكون أقل من 15 ميجابايت');
 const bitmap=await createImageBitmap(file);
 try{if(bitmap.width*bitmap.height>50000000)throw Error('أبعاد الصورة كبيرة جدًا؛ صغّرها الأول');
 const ratio=Math.min(1,PHOTO_POLICY.maxDimension/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('تعذّر تجهيز الصورة');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 let blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('تعذّر ضغط الصورة')),'image/webp',.9));
 if(blob.size>maxBytes)blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('تعذّر ضغط الصورة')),'image/webp',.75));
 if(blob.size>maxBytes)throw Error('الصورة بعد الضغط أكبر من '+Math.round(maxBytes/1000)+' كيلوبايت؛ قص الجزء المطلوب من الكود للحفاظ على وضوحه');
 return new File([blob],file.name.replace(/\.[^.]+$/,'')+(blob.type==='image/webp'?'.webp':'.png'),{type:blob.type});
 }finally{bitmap.close();}
}
export function photoDataUrl(file:File):Promise<string>{return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('تعذّر قراءة الصورة'));r.readAsDataURL(file);});}
