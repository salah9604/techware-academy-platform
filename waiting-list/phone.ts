/**
 * Egyptian mobile contact normalization for Techware registrations.
 * Google Sheets sometimes stores phone columns as numeric cells and loses
 * the first zero: 1012345678 => 01012345678.
 * Never invent missing digits other than this unambiguous leading zero.
 */
export type NormalizedPhone={
 local:string;
 international:string;
 whatsappUrl:string;
};
const arabicNumerals='٠١٢٣٤٥٦٧٨٩';
const persianNumerals='۰۱۲۳۴۵۶۷۸۹';
function westernDigits(value:string):string{
 return value.replace(/[٠-٩۰-۹]/g,c=>{
  const a=arabicNumerals.indexOf(c);
  return String(a>=0?a:persianNumerals.indexOf(c));
 });
}
export function normalizeEgyptianPhone(value:unknown):NormalizedPhone|null{
 if(value===undefined||value===null)return null;
 let text=westernDigits(String(value)).trim();
 if(!text)return null;
 // Ignore simple spreadsheet notes, but don't guess between multiple numbers.
 if(/[^\d+\s().\-/]/.test(text))return null;
 if(/[\/]/.test(text))return null;
 const digits=text.replace(/[^\d]/g,'');
 let national='';
 if(/^01[0125]\d{8}$/.test(digits))national=digits;
 else if(/^1[0125]\d{8}$/.test(digits))national='0'+digits;
 else if(/^201[0125]\d{8}$/.test(digits))national='0'+digits.slice(2);
 else if(/^2001[0125]\d{8}$/.test(digits))national=digits.slice(2);
 else if(/^00201[0125]\d{8}$/.test(digits))national='0'+digits.slice(4);
 else if(/^002001[0125]\d{8}$/.test(digits))national=digits.slice(4);
 if(!/^01[0125]\d{8}$/.test(national))return null;
 const international='20'+national.slice(1);
 return {local:national,international,whatsappUrl:'https://wa.me/'+international};
}
export function contactLinks(whatsapp:unknown,phone:unknown):{target:NormalizedPhone|null;fallback:boolean;localPhone:string|null}{
 const whatsappNumber=normalizeEgyptianPhone(whatsapp);
 const mobile=normalizeEgyptianPhone(phone);
 return {target:whatsappNumber||mobile,fallback:!whatsappNumber&&!!mobile,localPhone:mobile?.local||null};
}
