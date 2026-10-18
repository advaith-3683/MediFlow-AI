import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import postcss from "postcss";
const frontend=fileURLToPath(new URL("..",import.meta.url));
const originalNodeEnv=process.env.NODE_ENV, saved=new Map();
let dom,output,widgets,createRoot,mobile=false;
const mediaListeners=new Set();
const pages=["DoctorDashboardPage","DoctorAppointmentsPage","DoctorAvailabilityPage","DoctorProfilePage","DoctorPendingPage","ConsultationWorkspacePage"];
const adminPages=["AdminDashboardPage","AdminUsersPage","AdminDoctorsPage","AdminAppointmentsPage","AdminAnalyticsPage","AdminAuditLogsPage","AdminSettingsPage"];
let testRole="doctor";

test("metrics class defines its own grid without relying on extra utility classes",async()=>{
 const css=postcss.parse(await readFile(path.join(frontend,"src/index.css"),"utf8"));
 const rules=[];css.walkRules(".mf-metrics",rule=>rules.push(rule));
 const base=rules.find(rule=>rule.parent.type==="root");assert.ok(base,"Standalone metrics layout is required");
 const declarations=rule=>Object.fromEntries(rule.nodes.filter(node=>node.type==="decl").map(node=>[node.prop,node.value]));
 assert.equal(declarations(base).display,"grid");assert.equal(declarations(base)["grid-template-columns"],"repeat(2,minmax(0,1fr))");assert.equal(declarations(base).gap,"1.5rem");assert.equal(declarations(base)["align-items"],"start");
 const desktop=rules.find(rule=>rule.parent.params==="(min-width:1024px)");assert.ok(desktop);assert.equal(declarations(desktop)["grid-template-columns"],"repeat(4,minmax(0,1fr))");
 const narrow=rules.find(rule=>rule.parent.params==="(max-width:359px)");assert.ok(narrow);assert.equal(declarations(narrow)["grid-template-columns"],"minmax(0,1fr)");
});

before(async()=>{
 process.env.NODE_ENV="development";
 const temporary=path.join(frontend,"node_modules",".tmp");await mkdir(temporary,{recursive:true});output=await mkdtemp(path.join(temporary,"role-ui-"));
 const entry=pages.map(name=>`export {default as ${name}} from "/src/pages/doctor/${name}.tsx";`).join("\n")+adminPages.map(name=>`export {default as ${name}} from "/src/pages/admin/${name}.tsx";`).join("\n")+`
 export {default as NotificationsPage} from "/src/pages/shared/NotificationsPage.tsx";
 export {default as ConfirmDialog} from "/src/components/ui/ConfirmDialog.tsx";
 export {default as PatientShell} from "/src/components/layout/PatientShell.tsx";
 export {Avatar} from "/src/components/ui/Brand.tsx";
 export {AuthProvider} from "/src/auth/AuthContext.tsx";
 export {I18nProvider} from "/src/i18n/I18nContext.tsx";
 export {ToastProvider} from "/src/components/ui/Toast.tsx";
 export {Routes,Route,MemoryRouter} from "react-router-dom";`;
 await build({root:frontend,configFile:false,envDir:false,logLevel:"silent",define:{"import.meta.env.VITE_API_URL":JSON.stringify("https://backend.example.test")},plugins:[react(),{name:"role-ui-test",resolveId(id){if(id==="virtual:patient-ui")return "\0patient-ui"},load(id){if(id==="\0patient-ui")return entry}}],build:{ssr:true,outDir:output,emptyOutDir:false,rollupOptions:{input:"virtual:patient-ui",output:{entryFileNames:"entry.mjs"}}}});
 dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/"});
 for(const key of ["window","document","navigator","HTMLElement","Node","Event","MouseEvent","KeyboardEvent","localStorage"]){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:dom.window[key]})}
 saved.set("IS_REACT_ACT_ENVIRONMENT",Object.getOwnPropertyDescriptor(globalThis,"IS_REACT_ACT_ENVIRONMENT"));globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.matchMedia=query=>({get matches(){return query.includes("max-width")?mobile:false},media:query,addEventListener(_type,listener){mediaListeners.add(listener)},removeEventListener(_type,listener){mediaListeners.delete(listener)}});
 dom.window.HTMLElement.prototype.scrollIntoView=()=>Promise.resolve();dom.window.scrollTo=()=>{};
 ({createRoot}=await import("react-dom/client"));widgets=await import(pathToFileURL(path.join(output,"entry.mjs")).href);
});
after(async()=>{dom?.window.close();for(const[key,value]of saved){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}if(originalNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=originalNodeEnv;if(output)await rm(output,{recursive:true,force:true})});
const identity={id:"synthetic-patient",name:"Synthetic Clinician",email:"patient@example.test",phone:"1234567890",role:"doctor",isVerified:false,doctorVerificationStatus:"verified",isDoctorVerified:true};
const json=data=>new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});
async function mount(t,element,pathname="/patient/dashboard",shell=false,responses={}){
 testRole=pathname.startsWith("/admin")?"admin":"doctor";localStorage.clear();localStorage.setItem("token","synthetic-test-session");mobile=false;
 const errors=[],unknown=[],writes=[];
 t.mock.method(console,"error",(...args)=>errors.push(args.map(String).join(" ")));
 t.mock.method(globalThis,"fetch",async(url,options={})=>{
  const target=new URL(url),route=target.pathname,method=options.method||"GET";
  if(method!=="GET"){writes.push({route,body:options.body?JSON.parse(options.body):undefined});return json(route==="/api/auth/profile"?{user:{...identity,...JSON.parse(options.body)}}:{message:"Synthetic test save"})}
  if(Object.hasOwn(responses,route)){if(responses[route] instanceof Error)throw responses[route];return json(responses[route]);}
  if(route==="/api/auth/session")return json({user:{...identity,role:testRole}});
  if(route==="/api/admin/dashboard")return json({metrics:{totalPatients:12,totalDoctors:4,totalAppointments:9,pendingDoctors:2,scheduledAppointments:3,consultations:6,medicalRecords:5},recentActivity:[]});
  if(route==="/api/admin/users")return json({users:[],pages:1});
  if(route==="/api/admin/doctors")return json([]);
  if(route==="/api/admin/appointments")return json({appointments:[],pages:1});
  if(route==="/api/admin/audit-logs")return json({logs:[],pages:1});
  if(route==="/api/admin/analytics")return json({appointmentsByStatus:[],appointmentsBySpecialty:[],doctorsBySpecialty:[],appointmentsOverTime:[],consultationsOverTime:[],patientRegistrations:[],prescriptionCount:7});
  if(route==="/api/admin/settings")return json({platform:"Synthetic test platform",environment:"test",admin:{email:"admin@example.test"},editableServerSettings:false});
  if(route==="/api/doctor/appointments/dashboard")return json({doctor:{name:identity.name,specialty:"ENT"},todayCount:0,upcomingCount:0,completedConsultations:0,patientsSeen:0,today:[]});
  if(route==="/api/doctor/appointments")return json([]);
  if(route==="/api/doctor/clinical/availability")return json({availability:[],unavailableDates:[]});
  if(route==="/api/doctor/clinical/profile")return json({name:identity.name,email:identity.email,specialty:"ENT",isDoctorVerified:true,bio:"",languages:[],qualifications:[],experienceYears:0,consultationFee:0});
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

for(const name of pages.filter(name=>name!=="ConsultationWorkspacePage"))test(`${name} renders real controls without live services`,async t=>{
 const h=await mount(t,React.createElement(widgets[name]),"/doctor/dashboard");assert.equal(h.container.querySelectorAll("h1").length,1);assert.equal(h.container.querySelectorAll("main").length,1);assert.deepEqual(h.writes,[]);
 if(name!=="DoctorPendingPage")assert.ok(h.container.querySelector('a[href="/notifications"]'));
});
test("availability keeps its schedule payload and day controls",async t=>{
 const h=await mount(t,React.createElement(widgets.DoctorAvailabilityPage),"/doctor/availability");
 const monday=Array.from(h.container.querySelectorAll("label")).find(e=>e.textContent==="Monday").querySelector("input");await act(async()=>monday.click());
 assert.equal(h.container.querySelector('[aria-label="Monday start time"]').value,"09:00");
 const save=Array.from(h.container.querySelectorAll("button")).find(e=>e.textContent==="Save availability");await act(async()=>save.click());
 assert.deepEqual(h.writes[0],{route:"/api/doctor/clinical/availability",body:{availability:[{weekday:1,startTime:"09:00",endTime:"17:00",appointmentDurationMinutes:30}],unavailableDates:[],confirmConflicts:false}});
});
test("doctor profile credentials stay read-only and editable practice fields retain save action",async t=>{
 const h=await mount(t,React.createElement(widgets.DoctorProfilePage),"/doctor/profile");assert.equal(h.container.querySelectorAll("input[readonly]").length,4);
 await act(async()=>h.container.querySelector("form").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));assert.equal(h.writes[0].route,"/api/doctor/clinical/profile");assert.equal(h.writes[0].body.specialty,"ENT");
});
const clinical={appointment:{_id:"synthetic-encounter",__v:3,problem:"Synthetic concern",aiSummary:"",priority:"normal",startAt:"2030-01-01T10:00:00Z",status:"scheduled",patient:{_id:"synthetic-patient",name:"Synthetic Patient",email:"patient@example.test",phone:""},doctor:{name:identity.name,specialty:"ENT"}},consultation:null,records:[],prescriptions:[],previousConsultations:[],safetyProfile:{allergies:[],conditions:[],currentMedications:[]}};
function workspace(){return React.createElement(widgets.Routes,null,React.createElement(widgets.Route,{path:"/doctor/appointments/:id",element:React.createElement(widgets.ConsultationWorkspacePage)}))}
test("clinical workspace retains labeled notes, draft version and completion confirmation",async t=>{
 const h=await mount(t,workspace(),"/doctor/appointments/synthetic-encounter",false,{"/api/doctor/clinical/appointments/synthetic-encounter/context":clinical});
 for(const textarea of h.container.querySelectorAll("textarea"))assert.ok(textarea.labels.length);
 const button=text=>Array.from(h.container.querySelectorAll("button")).find(e=>e.textContent===text);
 await act(async()=>button("Save draft").click());assert.equal(h.writes[0].body.appointmentVersion,3);
 await act(async()=>button("Add medication").click());assert.equal(h.container.querySelectorAll('input:not([type="date"])').length,5);await act(async()=>button("Remove").click());
 await act(async()=>button("Complete consultation").click());assert.ok(document.querySelector('[role="alertdialog"]'));assert.equal(h.writes.length,1);
 await act(async()=>document.querySelector('[role="alertdialog"] button').click());assert.equal(document.querySelector('[role="alertdialog"]'),null);
});
test("completed clinical history preserves original notes, amendments and void controls",async t=>{
 const completed={...clinical,appointment:{...clinical.appointment,status:"completed"},consultation:{_id:"synthetic-consultation",status:"completed",chiefComplaint:"Original concern",clinicalNotes:"Original notes",amendments:[{_id:"a",text:"Original clarification"}]},prescriptions:[{_id:"synthetic-rx",appointment:{_id:"synthetic-encounter"},status:"active",medications:[{medicineName:"Synthetic medication",dosage:"Synthetic dosage",frequency:"Synthetic frequency",duration:"Synthetic duration",instructions:"Synthetic instruction"}],generalInstructions:"Original instructions"}]};
 const h=await mount(t,workspace(),"/doctor/appointments/synthetic-encounter",false,{"/api/doctor/clinical/appointments/synthetic-encounter/context":completed});
 assert.ok(h.container.textContent.includes("Original clarification"));assert.ok(h.container.textContent.includes("Synthetic medication"));assert.ok(h.container.querySelector("fieldset").disabled);
 const labels=Array.from(h.container.querySelectorAll("label"));const correction=labels.find(e=>e.textContent==="Clinical clarification").querySelector("textarea");await h.type(correction,"Synthetic amendment");
 const amend=Array.from(h.container.querySelectorAll("button")).find(e=>e.textContent==="Append consultation amendment");await act(async()=>amend.click());assert.equal(h.writes[0].route,"/api/doctor/clinical/consultations/synthetic-consultation/amendments");assert.equal(h.writes[0].body.text,"Synthetic amendment");assert.ok(h.writes[0].body.requestId);
});

for(const name of adminPages)test(`${name} renders its real page and backend fixture without writes`,async t=>{
 const h=await mount(t,React.createElement(widgets[name]),"/admin/dashboard");assert.equal(h.container.querySelectorAll("h1").length,1);assert.equal(h.container.querySelectorAll("main").length,1);assert.ok(h.container.querySelector('a[href="/notifications"]'));assert.deepEqual(h.writes,[]);
 if(name==="AdminDashboardPage")assert.ok(h.container.textContent.includes("12"));
 if(name==="AdminSettingsPage")assert.ok(h.container.textContent.includes("cannot be viewed or edited"));
});
for(const role of ["doctor","admin"])test(`${role} dashboard keeps four primary metrics and their backend meanings inside the shared grid`,async t=>{
 const doctor=role==="doctor";
 const response=doctor?{"/api/doctor/appointments/dashboard":{doctor:{name:identity.name,specialty:"ENT"},todayCount:2,upcomingCount:5,completedConsultations:9,patientsSeen:7,today:[]}}:{};
 const h=await mount(t,React.createElement(doctor?widgets.DoctorDashboardPage:widgets.AdminDashboardPage),`/${role}/dashboard`,false,response);
 const grid=h.container.querySelector(".mf-metrics");assert.ok(grid);assert.equal(h.container.querySelectorAll(".mf-metrics").length,1);
 const stats=Array.from(grid.children);assert.equal(stats.length,4);assert.ok(stats.every(stat=>stat.classList.contains("mf-stat")));
 assert.deepEqual(stats.map(stat=>[stat.querySelector("p").textContent,stat.querySelector("strong").textContent]),doctor?[["Today","2"],["Upcoming","5"],["Completed","9"],["Patients seen","7"]]:[["Patients","12"],["Doctors","4"],["Appointments","9"],["Pending verification","2"]]);
 assert.ok(stats.every(stat=>stat.querySelector("svg")));assert.deepEqual(h.writes,[]);
});
const applicant={_id:"synthetic-doctor",name:"Synthetic Applicant",email:"doctor@example.test",specialty:"ENT",doctorVerificationStatus:"pending",isDoctorVerified:false};
for(const rejected of [false,true])test(`doctor ${rejected?"rejection":"approval"} retains confirmation and exact decision payload`,async t=>{
 const h=await mount(t,React.createElement(widgets.AdminDoctorsPage),"/admin/doctors/verification",false,{"/api/admin/doctors":[applicant]});
 await act(async()=>h.container.querySelector(`[aria-label="${rejected?"Reject":"Approve"} ${applicant.name}"]`).click());
 const dialog=document.querySelector('[role="alertdialog"]');assert.ok(dialog);assert.equal(h.writes.length,0);assert.equal(dialog.querySelector("select").value,"ENT");
 if(rejected){await act(async()=>Array.from(dialog.querySelectorAll("button")).find(e=>e.textContent==="Reject").click());assert.equal(h.writes.length,0);await h.type(dialog.querySelector("textarea"),"Synthetic review reason");}
 await act(async()=>Array.from(dialog.querySelectorAll("button")).find(e=>e.textContent===(rejected?"Reject":"Approve")).click());
 assert.deepEqual(h.writes[0],{route:"/api/admin/doctors/synthetic-doctor/verification",body:{status:rejected?"rejected":"verified",specialty:"ENT",reason:rejected?"Synthetic review reason":""}});
});
for(const status of ["active","disabled"])test(`account ${status==="active"?"suspension":"reactivation"} retains confirmation and API contract`,async t=>{
 const h=await mount(t,React.createElement(widgets.AdminUsersPage),"/admin/users",false,{"/api/admin/users":{users:[{_id:"synthetic-user",name:"Synthetic Account",email:"user@example.test",role:"patient",isVerified:false,accountStatus:status,createdAt:"2030-01-01T00:00:00Z"}],pages:1}});
 const action=status==="active"?"Disable":"Reactivate";assert.ok(h.container.querySelector('[role="region"][tabindex="0"]'));
 await act(async()=>h.container.querySelector(`[aria-label="${action} account for Synthetic Account"]`).click());assert.equal(h.writes.length,0);
 await act(async()=>Array.from(document.querySelector('[role="alertdialog"]').querySelectorAll("button")).find(e=>e.textContent===action).click());
 assert.deepEqual(h.writes[0],{route:"/api/admin/users/synthetic-user/status",body:{accountStatus:status==="active"?"disabled":"active"}});
});
test("administrative cancellation retains reason requirement and appointment version",async t=>{
 const h=await mount(t,React.createElement(widgets.AdminAppointmentsPage),"/admin/appointments",false,{"/api/admin/appointments":{appointments:[{_id:"synthetic-appointment",__v:8,patient:{name:"Synthetic Patient"},doctor:{name:"Synthetic Doctor"},specialty:"ENT",startAt:"2030-01-01T10:00:00Z",priority:"urgent",status:"scheduled"}],pages:1}});
 await act(async()=>h.container.querySelector('[aria-label="Cancel appointment for Synthetic Patient"]').click());const dialog=document.querySelector('[role="alertdialog"]');
 await act(async()=>Array.from(dialog.querySelectorAll("button")).find(e=>e.textContent==="Cancel appointment").click());assert.equal(h.writes.length,0);
 await h.type(dialog.querySelector("textarea"),"Synthetic cancellation reason");await act(async()=>Array.from(dialog.querySelectorAll("button")).find(e=>e.textContent==="Cancel appointment").click());assert.deepEqual(h.writes[0],{route:"/api/admin/appointments/synthetic-appointment/cancel",body:{reason:"Synthetic cancellation reason",appointmentVersion:8}});
});
for(const role of ["doctor","admin"])test(`${role} mobile navigation preserves dialog focus, avatar and role-specific links`,async t=>{
 const h=await mount(t,React.createElement(role==="doctor"?widgets.DoctorDashboardPage:widgets.AdminDashboardPage),`/${role}/dashboard`);
 await act(async()=>{mobile=true;for(const listener of mediaListeners)listener()});const trigger=h.container.querySelector('[aria-label="Open navigation"]');await act(async()=>{trigger.focus();trigger.click()});
 const dialog=h.container.querySelector('[role="dialog"]');assert.ok(dialog);assert.equal(dialog.querySelector(".mf-avatar").textContent,"S");assert.ok(dialog.querySelector(`a[href="/${role}/${role==="doctor"?"availability":"users"}"]`));
 assert.ok(h.container.querySelector(".mf-app-main").hasAttribute("inert"));await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));assert.equal(document.activeElement,trigger);
});
test("audit event details retain readable metadata and keyboard-accessible disclosure",async t=>{
 const h=await mount(t,React.createElement(widgets.AdminAuditLogsPage),"/admin/audit-logs",false,{"/api/admin/audit-logs":{logs:[{_id:"synthetic-event",action:"DOCTOR_APPROVED",actorRole:"admin",targetType:"User",targetId:"synthetic-doctor",createdAt:"2030-01-01T10:00:00Z",metadata:{decision:"verified"}}],pages:1}});
 const details=h.container.querySelector("details");assert.ok(details.querySelector("summary"));assert.ok(details.textContent.includes("DOCTOR_APPROVED"));assert.equal(details.querySelector("pre").tabIndex,0);assert.ok(details.querySelector("pre").textContent.includes('"verified"'));
});

test("failed schedule loading reports an error and keeps uninitialized availability hidden",async t=>{
 const h=await mount(t,React.createElement(widgets.DoctorAvailabilityPage),"/doctor/availability",false,{"/api/doctor/clinical/availability":new Error("Synthetic unavailable service")});
 assert.ok(h.container.querySelector('[role="alert"]'));assert.equal(h.container.querySelector(".mf-surface").hidden,true);assert.deepEqual(h.writes,[]);
});
for(const role of ["doctor","admin"])test(`${role} notifications retain their role shell and owned inbox`,async t=>{
 const h=await mount(t,React.createElement(widgets.NotificationsPage),`/${role}/dashboard`);assert.equal(h.container.querySelector('[data-portal]').getAttribute('data-portal'),role);assert.equal(h.container.querySelectorAll("h1").length,1);assert.deepEqual(h.writes,[]);
});
