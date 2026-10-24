'use client';
import {useEffect,useState} from 'react';
import {type User,signOut} from 'firebase/auth';
import {firebaseAuth} from '../lib/firebase-client';
import {profileFor,bootstrapAdmin,activateLegacyInstructor,portalError} from '../lib/portal-client';
import Platform from './platform';
export default function PortalGate({user}:{user:User}){const [state,setState]=useState<'loading'|'pending'|'ready'>('loading'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function check(){setError('');try{let p=await profileFor(user.uid);if(!p){try{await activateLegacyInstructor(user.uid,user.displayName||user.email?.split('@')[0]||'مدرب Techware');p=await profileFor(user.uid);}catch{ /* The rules reject accounts that are not legacy instructors. */ }}setState(p?.active?'ready':'pending');}catch(e){setState('pending');setError(portalError(e));}}
 useEffect(()=>{check();},[user.uid]);
 if(state==='ready')return <Platform liveUid={user.uid}/>;
 return <main className="auth-page"><section className="auth-card"><h1>{state==='loading'?'جاري فتح حسابك…':'تفعيل حساب الأكاديمية'}</h1><p>رقم حسابك:</p><code className="auth-uid" dir="ltr">{user.uid}</code><p>المدرب المسجّل سابقًا يتفعّل تلقائيًا عند الدخول. الطلاب وأولياء الأمور يرسلوا الرقم للإدارة للربط.</p><button className="btn primary" disabled={busy} onClick={check}>إعادة التحقق</button><details><summary>تفعيل الإدارة</summary><p>حساب techwareacademy@gmail.com الموثّق، أو أي حساب كان Admin في النظام القديم، يقدر يفعّل الإدارة مرة واحدة.</p><button className="btn" disabled={busy} onClick={async()=>{setBusy(true);try{await bootstrapAdmin(user.uid,user.displayName||'إدارة Techware');await check();}catch(e){setError(portalError(e));}finally{setBusy(false);}}}>تفعيل حساب الإدارة الحالي</button></details>{error&&<p role="alert">{error}</p>}<button className="btn" onClick={()=>signOut(firebaseAuth())}>تسجيل الخروج</button><a href="/demo">فتح المعاينة المنفصلة</a></section></main>;
}
