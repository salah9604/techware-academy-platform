import type {State,Row} from './platform-model';
export const PHOTO_POLICY={retentionDays:90,maxFiles:5,maxInputBytes:15*1024*1024,maxOutputBytes:2*1024*1024,maxDimension:2560};
export function expiresAt(s:Row):string|null {
 if(s.status!=='complete'||s.keepPhotos||!s.reviewedAt)return null;
 const time=Date.parse(s.reviewedAt);return Number.isFinite(time)?new Date(time+PHOTO_POLICY.retentionDays*86400000).toISOString():null;
}
// Local-only cleanup: remote objects must be deleted by an authenticated storage job.
export function cleanLocalPhotos(state:State,now=Date.now()):State {
 const next=structuredClone(state);
 for(const sub of next.submissions){const expiry=expiresAt(sub);if(!expiry||Date.parse(expiry)>now)continue;
  for(const attempt of [sub,...(sub.history||[])])for(const file of attempt.files||[]){
   if(file.dataUrl){delete file.dataUrl;file.deletedAt=new Date(now).toISOString();}
  }
 }
 return next;
}
