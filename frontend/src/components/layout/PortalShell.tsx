import { useCallback, useEffect, useRef, useState, type ReactNode, type ElementType } from "react";
import { Bell, ChevronRight, HeartPulse, Languages, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { BrandMark, Avatar } from "../ui/Brand";
import NotificationBadge from "../ui/NotificationBadge";
import { LanguageSelect } from "../../i18n/I18nContext";
import { useDialogFocus } from "../ui/useDialogFocus";
export interface PortalLink { to: string; label: string; icon: ElementType }
export default function PortalShell({role,links,children}:{role:"Patient"|"Doctor"|"Admin";links:PortalLink[];children:ReactNode}) {
  const [open,setOpen]=useState(false),[mobile,setMobile]=useState(false);
  const {user,logout}=useAuth(); const navigate=useNavigate(); const location=useLocation();
  const sidebar=useRef<HTMLElement>(null),menuButton=useRef<HTMLButtonElement>(null); const close=useCallback(()=>setOpen(false),[]);
  useEffect(()=>{const media=window.matchMedia?.("(max-width: 1023px)");if(!media)return;const update=()=>{setMobile(media.matches);if(!media.matches)setOpen(false)};update();media.addEventListener("change",update);return()=>media.removeEventListener("change",update)},[]);
  useDialogFocus(open&&mobile,sidebar,close,false,menuButton);
  const current=links.find(link=>location.pathname===link.to)?.label||(location.pathname==="/notifications"?"Notifications":"Workspace");
  const signOut=()=>{logout();navigate("/login")};
  return <div className="mf-app" data-portal={role.toLowerCase()}><a href="#workspace-main" className="mf-skip-link">Skip to main content</a>
    <button aria-label="Close navigation" aria-hidden={!open} tabIndex={-1} onClick={close} className={`mf-scrim ${open?"is-open":""}`}/>
    <aside id="portal-navigation" ref={sidebar} tabIndex={-1} role={open&&mobile?"dialog":undefined} aria-modal={open&&mobile?true:undefined} aria-label={`${role} navigation`} className={`mf-sidebar ${open?"is-open":""}`}>
      <div className="mf-sidebar-brand"><BrandMark/><button onClick={close} aria-label="Close navigation" className="mf-icon-button lg:hidden"><X size={20}/></button><p>{role} workspace</p></div>
      <nav aria-label={`${role} pages`} className="mf-nav">{links.map(({to,label,icon:Icon})=><NavLink onClick={close} key={to} to={to} className={({isActive})=>`mf-nav-link ${isActive?"is-active":""}`}><Icon size={19} aria-hidden="true"/><span>{label}</span>{to==="/notifications"&&<NotificationBadge/>}<ChevronRight size={14} aria-hidden="true" className="ml-auto opacity-40"/></NavLink>)}</nav>
      {role==="Patient"&&<div className="mf-sidebar-note"><HeartPulse size={20} aria-hidden="true" className="mb-2"/><strong className="block text-[13px]">Care, connected.</strong>Your appointments, documents and care team in one place.</div>}
      <div className="mf-sidebar-user"><Avatar name={user?.name||role}/><div className="min-w-0 flex-1"><p className="truncate" title={user?.name||role}>{user?.name||role}</p><span className="mf-sidebar-role truncate">{role} account</span></div><button onClick={signOut} aria-label="Sign out" title="Sign out" className="mf-icon-button text-slate-500"><LogOut size={18}/></button></div>
    </aside>
    <div className="mf-app-main" inert={open&&mobile}><header className="mf-topbar"><button ref={menuButton} onClick={()=>setOpen(true)} aria-label="Open navigation" aria-controls="portal-navigation" aria-expanded={open} className="mf-icon-button mr-2 lg:hidden"><Menu size={21}/></button><div className="mf-topbar-title"><span className="hidden sm:inline">{role} portal</span><ChevronRight size={14} aria-hidden="true" className="hidden sm:inline"/><span className="font-medium text-slate-800">{current}</span></div><div className="ml-auto flex items-center gap-2 sm:gap-4"><span className="hidden items-center gap-2 xl:flex"><Languages size={16} aria-hidden="true" className="text-slate-500"/><LanguageSelect/></span><NavLink to="/notifications" aria-label="Notifications" className="mf-icon-button relative"><Bell size={20}/><span className="absolute right-1 top-1"><NotificationBadge/></span></NavLink><span className="hidden h-7 border-l border-slate-200 sm:block"/><Avatar name={user?.name||role} size="sm"/></div></header><main id="workspace-main" tabIndex={-1} className="mf-content">{children}</main><footer className="mx-auto flex max-w-[1360px] items-center justify-between gap-3 px-5 pb-6 text-xs text-slate-500 lg:px-9"><span>MediFlow AI · {role} workspace</span><span className="flex items-center gap-1.5"><ShieldCheck size={14} aria-hidden="true"/>Role-based access</span></footer></div>
  </div>;
}

