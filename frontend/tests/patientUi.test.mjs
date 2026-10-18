import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { build } from "vite";
import react from "@vitejs/plugin-react";
const frontend=fileURLToPath(new URL("..",import.meta.url));
const originalNodeEnv=process.env.NODE_ENV, saved=new Map();
let dom,output,widgets,createRoot,mobile=false;
const mediaListeners=new Set();
const pages=["DashboardPage","AIChatPage","AppointmentsPage","MedicalRecordsPage","PrescriptionsPage","ConsultationHistoryPage","SafetyProfilePage","ProfilePage","SettingsPage"];
before(async()=>{
 process.env.NODE_ENV="development";
 const temporary=path.join(frontend,"node_modules",".tmp");await mkdir(temporary,{recursive:true});output=await mkdtemp(path.join(temporary,"patient-ui-"));
 const entry=pages.map(name=>`export {default as ${name}} from "/src/pages/patient/${name}.tsx";`).join("\n")+`
 export {default as NotificationsPage} from "/src/pages/shared/NotificationsPage.tsx";
 export {default as ConfirmDialog} from "/src/components/ui/ConfirmDialog.tsx";
 export {default as PatientShell} from "/src/components/layout/PatientShell.tsx";
 export {Avatar} from "/src/components/ui/Brand.tsx";
 export {AuthProvider} from "/src/auth/AuthContext.tsx";
 export {I18nProvider} from "/src/i18n/I18nContext.tsx";
 export {ToastProvider} from "/src/components/ui/Toast.tsx";
 export {MemoryRouter} from "react-router-dom";`;
 await build({root:frontend,configFile:false,envDir:false,logLevel:"silent",define:{"import.meta.env.VITE_API_URL":JSON.stringify("https://backend.example.test")},plugins:[react(),{name:"patient-ui-test",resolveId(id){if(id==="virtual:patient-ui")return "\0patient-ui"},load(id){if(id==="\0patient-ui")return entry}}],build:{ssr:true,outDir:output,emptyOutDir:false,rollupOptions:{input:"virtual:patient-ui",output:{entryFileNames:"entry.mjs"}}}});
 dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/"});
 for(const key of ["window","document","navigator","HTMLElement","Node","Event","MouseEvent","KeyboardEvent","localStorage"]){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:dom.window[key]})}
 saved.set("IS_REACT_ACT_ENVIRONMENT",Object.getOwnPropertyDescriptor(globalThis,"IS_REACT_ACT_ENVIRONMENT"));globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.matchMedia=query=>({get matches(){return query.includes("max-width")?mobile:false},media:query,addEventListener(_type,listener){mediaListeners.add(listener)},removeEventListener(_type,listener){mediaListeners.delete(listener)}});
 dom.window.HTMLElement.prototype.scrollIntoView=()=>Promise.resolve();dom.window.scrollTo=()=>{};
 ({createRoot}=await import("react-dom/client"));widgets=await import(pathToFileURL(path.join(output,"entry.mjs")).href);
});
after(async()=>{dom?.window.close();for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}if(originalNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=originalNodeEnv;if(output)await rm(output,{recursive:true,force:true})});
const identity={id:"synthetic-patient",name:"Synthetic Patient",email:"patient@example.test",phone:"1234567890",role:"patient",isVerified:false};
const json=data=>new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});
test("avatar uses one uppercase display-name initial with fixed circular sizing",async t=>{
 const h=await mount(t,React.createElement(widgets.Avatar,{name:"  ada Lovelace  "}));
 const avatar=h.container.querySelector(".mf-avatar");assert.equal(avatar.textContent,"A");
 for(const token of ["grid","place-items-center","rounded-full","aspect-square","shrink-0","h-10","w-10"])assert.ok(avatar.classList.contains(token));
 await h.render(React.createElement(widgets.Avatar,{name:"éva Example",size:"sm"}));assert.equal(h.container.querySelector(".mf-avatar").textContent,"É");
});
test("sidebar role styling cannot override avatar centering and long names retain truncation",async t=>{
 const name="alexandria with a very long display name";
 const h=await mount(t,React.createElement("h1",null,"Workspace"),"/patient/dashboard",true,{"/api/auth/session":{user:{...identity,name}}});
 const row=h.container.querySelector(".mf-sidebar-user"),avatar=row.querySelector(".mf-avatar");assert.equal(avatar.textContent,"A");
 assert.equal(row.querySelector("p").textContent,name);assert.ok(row.querySelector("p").classList.contains("truncate"));assert.equal(row.querySelector("p").title,name);
 assert.equal(row.querySelector(".mf-sidebar-role").textContent,"Patient account");assert.ok(row.querySelector('[aria-label="Sign out"]').classList.contains("mf-icon-button"));
 const css=await readFile(path.join(frontend,"src/index.css"),"utf8");
 const roleRule=Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).find(([,selector,body])=>selector.includes(".mf-sidebar-user")&&body.includes("font-size:12px"));
 assert.ok(roleRule);assert.equal(avatar.matches(roleRule[1].trim()),false);assert.equal(row.querySelector(".mf-sidebar-role").matches(roleRule[1].trim()),true);
});
async function mount(t,element,pathname="/patient/dashboard",shell=false,responses={}){
 localStorage.clear();localStorage.setItem("token","synthetic-test-session");mobile=false;
 const errors=[],unknown=[],writes=[];
 t.mock.method(console,"error",(...args)=>errors.push(args.map(String).join(" ")));
 t.mock.method(globalThis,"fetch",async(url,options={})=>{
  const target=new URL(url),route=target.pathname,method=options.method||"GET";
  if(method!=="GET"){writes.push({route,body:options.body?JSON.parse(options.body):undefined});return json(route==="/api/auth/profile"?{user:{...identity,...JSON.parse(options.body)}}:{message:"Synthetic test save"})}
  if(Object.hasOwn(responses,route))return json(responses[route]);
  if(route==="/api/auth/session")return json({user:identity});
  if(route==="/api/auth/profile")return json(identity);
  if(route==="/api/appointments/dashboard")return json({upcomingAppointments:0,medicalRecords:0,prescriptions:0,completedConsultations:0,nextAppointment:null});
  if(route==="/api/auth/specialties")return json(["ENT","Dentist"]);
  if(["/api/appointments/my","/api/medical-records/my","/api/patient/prescriptions","/api/patient/consultations"].includes(route))return json([]);
  if(route==="/api/medical-records/types")return json(["Prescription","Lab Report","Scan","Diagnosis","Discharge Summary","Other"]);
  if(route==="/api/medical-records/capabilities")return json({fileUploadsEnabled:false,maxFileSize:10485760});
  if(route==="/api/patient/safety-profile")return json({allergies:[],currentMedications:[],conditions:[]});
  if(route==="/api/notifications/preferences")return json({appointmentReminders:true,healthTips:false});
  if(route==="/api/notifications")return json({notifications:[],unreadCount:0,hasMore:false});
  unknown.push(route);throw new Error("Unmocked network request refused");
 });
 const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
 const render=async child=>act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(widgets.MemoryRouter,{initialEntries:[pathname]},React.createElement(widgets.AuthProvider,null,React.createElement(widgets.I18nProvider,null,React.createElement(widgets.ToastProvider,null,shell?React.createElement(widgets.PatientShell,null,child):child)))))));
 await render(element);
 t.after(async()=>{await act(async()=>root.unmount());container.remove();assert.deepEqual(unknown,[]);assert.deepEqual(errors,[]);assert.equal(document.body.style.overflow,"")});
 const type=async(input,value)=>act(async()=>{Object.getOwnPropertyDescriptor(input.tagName==="TEXTAREA"?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype,"value").set.call(input,value);input.dispatchEvent(new dom.window.Event("input",{bubbles:true}))});
 return{container,root,render,writes,type};
}
for(const name of [...pages,"NotificationsPage"])test(`${name} renders its actual patient controls and empty state without network or clinical fixtures`,async t=>{
 const h=await mount(t,React.createElement(widgets[name]),name==="NotificationsPage"?"/notifications":"/patient/dashboard",name!=="NotificationsPage");
 assert.equal(h.container.querySelectorAll("h1").length,1);assert.equal(h.container.querySelectorAll("main").length,1);assert.ok(h.container.querySelector('a[href="#workspace-main"]'));
 assert.equal(h.container.querySelector('[role="alert"]'),null);assert.deepEqual(h.writes,[]);
});
test("confirmation traps Tab, handles Escape and restores the triggering control",async t=>{
 function DialogExample(){const[open,setOpen]=React.useState(false);return React.createElement(React.Fragment,null,React.createElement("button",{onClick:()=>setOpen(true)},"Open confirmation"),React.createElement(widgets.ConfirmDialog,{open,title:"Confirm test action",onCancel:()=>setOpen(false),onConfirm:()=>{}},"No records are changed by this test."))}
 const h=await mount(t,React.createElement(DialogExample));const trigger=h.container.querySelector("button");await act(async()=>{trigger.focus();trigger.click()});
 const dialog=document.querySelector('[role="alertdialog"]'),buttons=dialog.querySelectorAll("button");assert.equal(document.activeElement,buttons[0]);assert.ok(dialog.getAttribute("aria-labelledby"));
 await act(async()=>{buttons[1].focus();document.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}))});assert.equal(document.activeElement,buttons[0]);
 await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Tab",shiftKey:true,bubbles:true,cancelable:true})));assert.equal(document.activeElement,buttons[1]);
 await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));assert.equal(document.querySelector('[role="alertdialog"]'),null);assert.equal(document.activeElement,trigger);
});
test("busy confirmation cannot be dismissed with Escape or its cancel control",async t=>{
 let cancelled=0;await mount(t,React.createElement(widgets.ConfirmDialog,{open:true,busy:true,title:"Working",onCancel:()=>cancelled++,onConfirm:()=>{}},"Synthetic action only"));
 const dialog=document.querySelector('[role="alertdialog"]');assert.equal(dialog.querySelector("button").disabled,true);
 await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));assert.equal(cancelled,0);
});
test("mobile navigation traps focus, closes with Escape, restores focus and releases background inertness",async t=>{
 const h=await mount(t,React.createElement("h1",null,"Patient workspace"),"/patient/dashboard",true);
 await act(async()=>{mobile=true;for(const listener of mediaListeners)listener()});
 const trigger=h.container.querySelector('[aria-label="Open navigation"]');await act(async()=>{trigger.focus();trigger.click()});
 const dialog=h.container.querySelector('[role="dialog"]');assert.ok(dialog);assert.equal(document.body.style.overflow,"hidden");assert.ok(h.container.querySelector(".mf-app-main").hasAttribute("inert"));
 await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));assert.equal(document.activeElement,trigger);assert.equal(h.container.querySelector(".mf-app-main").hasAttribute("inert"),false);
});
test("profile changes preserve the owned name/phone API contract and read-only email",async t=>{
 const h=await mount(t,React.createElement(widgets.ProfilePage),"/patient/profile",true);const input=h.container.querySelector('input[autocomplete="name"]');await h.type(input,"Synthetic Updated");
 assert.equal(h.container.querySelector('input[type="email"]').readOnly,true);await act(async()=>h.container.querySelector("form").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
 assert.deepEqual(h.writes,[{route:"/api/auth/profile",body:{name:"Synthetic Updated",phone:"1234567890"}}]);
});
test("safety profile retains editable newlines and saves the existing array payload",async t=>{
 const h=await mount(t,React.createElement(widgets.SafetyProfilePage),"/patient/safety-profile",true);const input=h.container.querySelector("textarea");assert.ok(input.labels.length);
 await h.type(input,"Synthetic first\n\nSynthetic second\n");assert.equal(input.value,"Synthetic first\n\nSynthetic second\n");
 await act(async()=>h.container.querySelector("form").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
 assert.deepEqual(h.writes[0],{route:"/api/patient/safety-profile",body:{allergies:["Synthetic first","Synthetic second"],currentMedications:[],conditions:[]}});
});
test("settings persist the same boolean preferences and clearly disclose unavailable reminder delivery",async t=>{
 const h=await mount(t,React.createElement(widgets.SettingsPage),"/patient/settings",true);const switches=h.container.querySelectorAll('[role="switch"]');assert.equal(switches[0].checked,true);assert.equal(switches[1].checked,false);
 await act(async()=>switches[0].click());const save=Array.from(h.container.querySelectorAll("button")).find(button=>button.textContent.includes("Save preferences"));await act(async()=>save.click());
 assert.deepEqual(h.writes[0],{route:"/api/notifications/preferences",body:{appointmentReminders:false,healthTips:false}});assert.match(h.container.textContent,/not sent in this portfolio demo/);
});
test("prescription medicine, void reason, amendment history and print control remain available",async t=>{
 const record={_id:"synthetic-prescription",status:"voided",voidReason:"Synthetic void reason",createdAt:"2030-01-01T09:00:00.000Z",doctor:{name:"Synthetic Clinician",specialty:"ENT"},patient:{name:identity.name},medications:[{medicineName:"Synthetic medicine",dosage:"Synthetic dosage",frequency:"Synthetic frequency",duration:"Synthetic duration",instructions:"Synthetic instructions"}],generalInstructions:"Synthetic general instructions",followUpDate:null,amendments:[{_id:"synthetic-amendment",text:"Synthetic clarification",createdAt:"2030-01-02T09:00:00.000Z"}]};
 const h=await mount(t,React.createElement(widgets.PrescriptionsPage),"/patient/prescriptions",true,{"/api/patient/prescriptions":[record]});
 for(const text of ["Synthetic medicine","Synthetic dosage","Synthetic frequency","Synthetic duration","Synthetic instructions","Synthetic void reason","Synthetic clarification"])assert.ok(h.container.textContent.includes(text));
 let printed=0;t.mock.method(window,"print",()=>printed++);const button=h.container.querySelector('[aria-label^="Print prescription"]');await act(async()=>button.click());assert.equal(printed,1);assert.equal(document.activeElement.classList.contains("prescription-print"),true);
});
test("medical record view/download/delete controls are retained and cancellation does not write",async t=>{
 const record={_id:"synthetic-record",title:"Synthetic document",recordType:"Lab Report",fileUrl:"/uploads/synthetic.pdf",createdAt:"2030-01-01T09:00:00.000Z"};
 const h=await mount(t,React.createElement(widgets.MedicalRecordsPage),"/patient/medical-records",true,{"/api/medical-records/my":[record]});
 const buttons=Array.from(h.container.querySelectorAll("button"));assert.ok(buttons.some(button=>button.textContent==="View"));assert.ok(buttons.some(button=>button.textContent==="Download"));assert.equal(h.container.querySelector('input[type="file"]').disabled,true);
 await act(async()=>h.container.querySelector('[aria-label="Delete Synthetic document"]').click());assert.ok(document.querySelector('[role="alertdialog"]'));
 const cancel=Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(button=>button.textContent==="Cancel");await act(async()=>cancel.click());assert.deepEqual(h.writes,[]);
});
test("notification read action preserves its owned endpoint and details link",async t=>{
 const item={_id:"synthetic-notification",title:"Synthetic care update",message:"Synthetic event",link:"/patient/appointments",readAt:null,createdAt:"2030-01-01T09:00:00.000Z"};
 const h=await mount(t,React.createElement(widgets.NotificationsPage),"/notifications",false,{"/api/notifications":{notifications:[item],unreadCount:1,hasMore:false}});
 assert.equal(Array.from(h.container.querySelectorAll("a")).find(link=>link.textContent==="View details").getAttribute("href"),"/patient/appointments");
 await act(async()=>Array.from(h.container.querySelectorAll("button")).find(button=>button.textContent==="Mark read").click());assert.equal(h.writes[0].route,"/api/notifications/synthetic-notification/read");
});
test("existing appointment reschedule and cancel controls remain wired without creating a booking",async t=>{
 const item={_id:"synthetic-appointment",__v:0,status:"scheduled",startAt:"2035-01-01T09:00:00.000Z",durationMinutes:30,problem:"Synthetic concern",priority:"normal",specialty:"ENT",doctor:{_id:"synthetic-doctor",name:"Synthetic Clinician",specialty:"ENT"}};
 const h=await mount(t,React.createElement(widgets.AppointmentsPage),"/patient/appointments",true,{"/api/appointments/my":[item]});
 await act(async()=>h.container.querySelector('[aria-label^="Reschedule appointment"]').click());assert.ok(h.container.textContent.includes("Choose a new time with Synthetic Clinician"));
 await act(async()=>Array.from(h.container.querySelectorAll("button")).find(button=>button.textContent==="Cancel reschedule").click());
 await act(async()=>h.container.querySelector('[aria-label^="Cancel appointment"]').click());assert.ok(document.querySelector('[role="alertdialog"]'));assert.deepEqual(h.writes,[]);
});
