import {getApp,getApps,initializeApp} from 'firebase/app';
import {getAuth} from 'firebase/auth';
// Public web-app configuration. Never put service-account keys in this file.
export const firebaseConfig={projectId:'techware-instructor',appId:'1:257053522854:web:e1eec8b9319a040038ad67',apiKey:'AIzaSyDbO_0fG_XkZZy3vX-sdx0ps5GaLKrJqAc',authDomain:'techware-instructor.firebaseapp.com',messagingSenderId:'257053522854'};
export function firebaseAuth(){
 if(typeof window==='undefined')throw Error('Firebase Auth is browser-only');
 const app=getApps().some(a=>a.name==='techware-portal')?getApp('techware-portal'):initializeApp(firebaseConfig,'techware-portal');
 return getAuth(app);
}
