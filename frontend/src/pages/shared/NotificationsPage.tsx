import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { createLatestRequest } from "../../api/latestRequest";
import { apiRequest } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import PatientShell from "../../components/layout/PatientShell";
import DoctorShell from "../../components/doctor/DoctorShell";
import AdminShell from "../../components/admin/AdminShell";
import { Badge, Button, EmptyState, Notice, PageHeader, PageLoader, Surface } from "../../components/ui/Core";
interface Item { _id: string; title: string; message: string; link: string; readAt: string | null; createdAt: string }
export default function NotificationsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]), [unread, setUnread] = useState(0), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false);
  const [gate] = useState(createLatestRequest);
  const load = useCallback(async () => {
    const request = gate.start(); setLoading(true); setError("");
    try {
      const data = await apiRequest<{ notifications: Item[]; unreadCount: number; hasMore: boolean }>(`/api/notifications?page=${page}`, {signal:request.signal});
      if (!request.isCurrent()) return;
      setItems(data.notifications); setUnread(data.unreadCount); setHasMore(data.hasMore);
    } catch (e) { if (request.isCurrent()) setError(e instanceof Error ? e.message : "Unable to load notifications"); }
    finally { if (request.isCurrent()) setLoading(false); }
  }, [page, gate]);
  useEffect(() => { void load(); const refresh=()=>{void load()}; const timer=window.setInterval(refresh,60000); window.addEventListener("focus",refresh); return () => {gate.invalidate();window.clearInterval(timer);window.removeEventListener("focus",refresh)}; }, [load, gate]);
  const read = async (id?: string) => {
    setBusy(true); setError("");
    try { await apiRequest(`/api/notifications/${id ? `${id}/read` : "read-all"}`, { method: "PATCH" }); window.dispatchEvent(new Event("mediflow:notifications-changed")); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to mark notifications read"); }
    finally { setBusy(false); }
  };
  const content = <div className="mf-page"><PageHeader eyebrow={loading?"Your inbox":`${unread} unread`} title="Notifications" description="Care updates and account activity, all in one place." action={unread ? <Button variant="secondary" disabled={busy || loading} onClick={() => void read()}><CheckCheck size={17} aria-hidden="true"/>Mark all read</Button> : undefined}/>
    {error && <Notice tone="error">{error}<button className="ml-3 font-semibold underline" onClick={() => void load()}>Try again</button></Notice>}
    {loading?<PageLoader label="Loading notifications"/>:<Surface className="overflow-hidden">{!items.length ? !error && <EmptyState icon={<Bell size={24}/>} title="Nothing on this page just yet" description="Updates about appointments, consultations and your account will appear here."/> : <div>{items.map((item,index)=><article key={item._id} className={`flex items-start gap-4 px-5 py-5 sm:px-7 ${index?"border-t border-slate-200":""} ${item.readAt?"bg-white":"bg-blue-50/35"}`}><span className={`mf-document-icon hidden sm:grid ${item.readAt?"!bg-slate-100 !text-slate-500":""}`}><Bell size={21} aria-hidden="true"/></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-semibold">{item.title}</h2>{!item.readAt&&<Badge tone="info">Unread</Badge>}</div><time className="mt-1 block text-xs leading-6 text-slate-600">{new Date(item.createdAt).toLocaleString()}</time></div>{!item.readAt&&<Button variant="ghost" disabled={busy} onClick={()=>void read(item._id)}>Mark read</Button>}</div><p className="mt-3 text-sm leading-7 text-slate-700">{item.message}</p>{item.link.startsWith("/")&&!item.link.startsWith("//")&&<Link to={item.link} className="mf-button mf-button-secondary mt-4">View details</Link>}</div></article>)}</div>}</Surface>}
    <nav aria-label="Notification pages" className="flex flex-wrap items-center justify-end gap-3"><Button variant="secondary" disabled={page===1||loading||busy} onClick={()=>setPage(value=>value-1)}>Previous</Button><span className="text-sm text-slate-600">Page {page}</span><Button variant="secondary" disabled={!hasMore||loading||busy} onClick={()=>setPage(value=>value+1)}>Next</Button></nav>
  </div>;
  return <RoleShell role={user?.role}>{content}</RoleShell>;
}
function RoleShell({ role, children }: { role?: string; children: ReactNode }) { if (role === "doctor") return <DoctorShell>{children}</DoctorShell>; if (role === "admin") return <AdminShell>{children}</AdminShell>; return <PatientShell>{children}</PatientShell>; }
