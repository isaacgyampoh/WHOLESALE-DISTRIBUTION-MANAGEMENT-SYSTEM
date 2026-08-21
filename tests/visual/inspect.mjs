import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createChunks } from "@supabase/ssr/dist/main/utils/chunker.js";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const l of fs.readFileSync(path.join(here,"..","..",".env.local"),"utf8").split("\n")) {
  const t=l.trim(); if(!t||t.startsWith("#"))continue; const i=t.indexOf("=");
  if(i>0) env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^["']|["']$/g,"");
}
const url=env.NEXT_PUBLIC_SUPABASE_URL, ref=new URL(url).hostname.split(".")[0];
const admin=createClient(url,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const stamp=Date.now().toString(36), password=`Ins-${stamp}-Aa1!`; const ids=[];
const { data: org } = await admin.from("organizations").select("id").limit(1).single();
const mk=async(role,name)=>{const email=`htest-ins-${role}-${stamp}@example.com`;
  const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,
    user_metadata:{full_name:name,role,org_id:org.id}}); if(error)throw error; ids.push(data.user.id); return email;};
const ck=async(email)=>{const c=createClient(url,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await c.auth.signInWithPassword({email,password}); if(error)throw error;
  const enc="base64-"+Buffer.from(JSON.stringify(data.session),"utf8").toString("base64url");
  return createChunks(`sb-${ref}-auth-token`,enc).map(x=>({name:x.name,value:x.value,domain:"localhost",path:"/"}));};

const b=await chromium.launch();
try{
  const adminEmail=await mk("admin","Ama Boateng");
  const driverEmail=await mk("driver","Kojo Mensah");

  const ctx=await b.newContext({viewport:{width:1440,height:900}});
  await ctx.addCookies(await ck(adminEmail));
  const p=await ctx.newPage();
  await p.goto("http://localhost:3000/",{waitUntil:"domcontentloaded"});
  await p.waitForLoadState("load");

  console.log("=== header email typography ===");
  console.log(await p.evaluate(()=>{
    const el=[...document.querySelectorAll("p")].find(e=>e.textContent.includes("@example.com"));
    const name=[...document.querySelectorAll("p")].find(e=>e.textContent.trim()==="Ama Boateng");
    const cs=el?getComputedStyle(el):null, cn=name?getComputedStyle(name):null;
    return { email:{family:cs?.fontFamily.slice(0,40), size:cs?.fontSize, variant:cs?.fontVariantNumeric},
             name:{family:cn?.fontFamily.slice(0,40), size:cn?.fontSize} };
  }));

  console.log("\n=== contrast of muted text on its background ===");
  console.log(await p.evaluate(()=>{
    const lum=(c)=>{const [r,g,bb]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});
      return 0.2126*r+0.7152*g+0.0722*bb;};
    const parse=(s)=>s.match(/\d+(\.\d+)?/g).slice(0,3).map(Number);
    const ratio=(f,b)=>{const L1=lum(parse(f)),L2=lum(parse(b));const [a,c]=L1>L2?[L1,L2]:[L2,L1];return ((a+0.05)/(c+0.05)).toFixed(2);};
    const out=[];
    for(const sel of ["p.text-xs",'[class*="text-\\\\[var\\\\(--text-muted"]',"h1","h2"]){
      const el=document.querySelector(sel); if(!el)continue;
      const cs=getComputedStyle(el);
      let bgEl=el, bg=getComputedStyle(bgEl).backgroundColor;
      while(bg==="rgba(0, 0, 0, 0)"&&bgEl.parentElement){bgEl=bgEl.parentElement;bg=getComputedStyle(bgEl).backgroundColor;}
      out.push(`${sel.slice(0,28)} ${cs.fontSize} ratio ${ratio(cs.color,bg)}`);
    }
    // The uppercase tile labels and sub-text specifically.
    const label=[...document.querySelectorAll("p")].find(e=>e.textContent==="CASH SALES TODAY");
    const sub=[...document.querySelectorAll("p")].find(e=>e.textContent==="0 van sales recorded");
    for(const [n,el] of [["tile label",label],["tile sub",sub]]){
      if(!el)continue; const cs=getComputedStyle(el);
      let bgEl=el,bg=getComputedStyle(bgEl).backgroundColor;
      while(bg==="rgba(0, 0, 0, 0)"&&bgEl.parentElement){bgEl=bgEl.parentElement;bg=getComputedStyle(bgEl).backgroundColor;}
      out.push(`${n} ${cs.fontSize} ratio ${ratio(cs.color,bg)}`);
    }
    return out;
  }));
  await ctx.close();

  console.log("\n=== bottom bar contents per role (390px) ===");
  for(const [role,email] of [["admin",adminEmail],["driver",driverEmail]]){
    const c2=await b.newContext({viewport:{width:390,height:844}});
    await c2.addCookies(await ck(email));
    const p2=await c2.newPage();
    await p2.goto("http://localhost:3000/",{waitUntil:"domcontentloaded"});
    await p2.waitForLoadState("load");
    const items=await p2.$$eval('nav[aria-label="Primary"] a, nav[aria-label="Primary"] button',
      els=>els.map(e=>e.textContent.trim()));
    console.log(`  ${role.padEnd(7)} ${items.join(" | ")}`);
    await c2.close();
  }
} finally { await b.close(); for(const id of ids) await admin.auth.admin.deleteUser(id); }
