import {timingSafeEqual} from 'node:crypto';
import {syncRoster} from './waitlist.js';

const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});
export async function GET(request:Request):Promise<Response>{
 const secret=process.env.CRON_SECRET;
 if(!secret)return reply({ok:false,error:'CRON_SECRET غير مجهز'},503);
 const bearer=request.headers.get('authorization')||'';
 const actual=Buffer.from(bearer);
 const expected=Buffer.from('Bearer '+secret);
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return reply({error:'Unauthorized'},401);
 if(!process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON)
  return reply({ok:false,configured:false,error:'اعتماد Google الدائم لم يتم إعداده بعد'},503);
 try{
  const outcome=await syncRoster({onlyIfStale:true});
  return reply({ok:true,configured:true,count:outcome.count,syncedAt:outcome.syncedAt,skipped:outcome.skipped});
 }catch(error){
  const e=error as Error&{status?:number};
  return reply({ok:false,configured:true,error:e.message||'تعذرت المزامنة'},e.status||502);
 }
}
