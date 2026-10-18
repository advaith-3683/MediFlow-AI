import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
type ToastKind="success"|"error"|"warning"|"info";
type Toast={id:number;kind:ToastKind;message:string};
const ToastContext=createContext<((message:string,kind?:ToastKind)=>void)|null>(null);
export function ToastProvider({children}:{children:ReactNode}) {
  const[items,setItems]=useState<Toast[]>([]);const timers=useRef(new Map<number,number>());const sequence=useRef(0);
  const dismiss=useCallback((id:number)=>{window.clearTimeout(timers.current.get(id));timers.current.delete(id);setItems(current=>current.filter(item=>item.id!==id))},[]);
  const show=useCallback((message:string,kind:ToastKind="info")=>{const id=++sequence.current;setItems(current=>[...current.slice(-3),{id,kind,message}]);if(kind!=="error")timers.current.set(id,window.setTimeout(()=>dismiss(id),6500))},[dismiss]);
  useEffect(()=>{const active=timers.current;return()=>{for(const timer of active.values())window.clearTimeout(timer);active.clear()}},[]);
  const value=useMemo(()=>show,[show]);
  return <ToastContext.Provider value={value}>{children}<div className="fixed bottom-4 right-4 z-[110] grid w-[calc(100%-2rem)] max-w-sm gap-3 sm:bottom-6 sm:right-6" aria-label="Application feedback">{items.map(item=>{const Icon=item.kind==="success"?CheckCircle2:item.kind==="error"?CircleAlert:Info;return <div key={item.id} role={item.kind==="error"?"alert":"status"} className={`mf-notice mf-notice-${item.kind} bg-white shadow-lg`}><Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0"/><p className="min-w-0 flex-1">{item.message}</p><button type="button" onClick={()=>dismiss(item.id)} aria-label="Dismiss notification" className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-black/5"><X size={16}/></button></div>})}</div></ToastContext.Provider>;
}
// oxlint-disable-next-line react/only-export-components
export function useToast(){const value=useContext(ToastContext);if(!value)throw new Error("useToast must be used inside ToastProvider");return value}
