import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock, Sparkles } from "lucide-react";
import { apiRequest } from "../../api/client";
import { createLatestRequest } from "../../api/latestRequest";
import { useI18n } from "../../i18n/I18nContext";
import { Avatar } from "../../components/ui/Brand";
import { Badge, Button, EmptyState, Notice as Feedback, PageHeader, Surface } from "../../components/ui/Core";
import ConfirmDialog from "../../components/ui/ConfirmDialog";

interface Doctor { _id: string; name: string; specialty: string; qualifications: string[]; consultationFee?: number | null; languages: string[]; isRecommended: boolean; nextAvailableAt: string; recommendationReason: string }
interface Slot { startAt: string; durationMinutes: number }
interface Triage { guidanceSource?: string; priority: "NORMAL" | "URGENT" | "EMERGENCY"; specialties: string[]; summary: string; recommendation: string; doctors: Doctor[]; message: string }
interface Appointment { _id: string; __v?: number; problem: string; specialty: string; startAt: string | null; status: "scheduled" | "completed" | "cancelled"; doctor: { _id: string; name: string; specialty: string } }
const NO_MATCH = "No matching verified doctors are currently available.";

export default function AppointmentsPage() {
  const { language } = useI18n();
  const bookingRequest = useRef<{ signature: string; id: string } | null>(null);
  const guidance = useRef(createLatestRequest()).current, slotRequests = useRef(createLatestRequest()).current;
  const [items, setItems] = useState<Appointment[]>([]), [doctors, setDoctors] = useState<Doctor[]>([]), [specialties, setSpecialties] = useState<string[]>([]);
  const [manualSpecialty, setManualSpecialty] = useState(""), [manual, setManual] = useState(false), [problem, setProblem] = useState("");
  const [triage, setTriage] = useState<Triage | null>(null), [doctorId, setDoctorId] = useState(""), [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]), [slot, setSlot] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(true), [analyzing, setAnalyzing] = useState(false), [slotsLoading, setSlotsLoading] = useState(false), [working, setWorking] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [discoveryMessage, setDiscoveryMessage] = useState("");
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null), [cancelling, setCancelling] = useState<Appointment | null>(null);
  const emergency = triage?.priority === "EMERGENCY";
  const loadItems = useCallback(async () => setItems(await apiRequest<Appointment[]>("/api/appointments/my")), []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([apiRequest<Appointment[]>("/api/appointments/my", { signal: controller.signal }), apiRequest<string[]>("/api/auth/specialties", { signal: controller.signal }, false)])
      .then(([appointments, supported]) => { if (!controller.signal.aborted) { setItems(appointments); setSpecialties(supported); } })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); guidance.invalidate(); slotRequests.invalidate(); };
  }, [guidance, slotRequests]);
  useEffect(() => {
    setSlot(null); setSlots([]);
    if (!doctorId || !date || emergency) { setSlotsLoading(false); return; }
    const request = slotRequests.start(); setSlotsLoading(true);
    apiRequest<Slot[]>(`/api/appointments/doctors/${doctorId}/slots?date=${date}${rescheduling ? `&excludeAppointmentId=${rescheduling._id}` : ""}`, { signal: request.signal })
      .then((value) => { if (request.isCurrent()) setSlots(value); }).catch((e) => { if (request.isCurrent()) setError(e.message); })
      .finally(() => { if (request.isCurrent()) setSlotsLoading(false); });
    return () => slotRequests.invalidate();
  }, [doctorId, date, emergency, slotRequests, rescheduling]);
  const clearSelection = () => { slotRequests.invalidate(); setDoctorId(""); setDate(""); setSlots([]); setSlot(null); setSlotsLoading(false); };
  const changeProblem = (value: string) => {
    bookingRequest.current = null; guidance.invalidate(); clearSelection(); setProblem(value); setTriage(null); setDoctors([]); setManual(false); setManualSpecialty(""); setAnalyzing(false); setDiscoveryMessage(""); setError(""); setNotice("");
  };
  const analyze = async () => {
    if (!problem.trim() || working) return;
    const request = guidance.start(); clearSelection(); setTriage(null); setDoctors([]); setManual(false); setManualSpecialty(""); setAnalyzing(true); setError(""); setDiscoveryMessage(""); setNotice("");
    try {
      const value = await apiRequest<Triage>("/api/ai/triage", { method: "POST", signal: request.signal, body: JSON.stringify({ problem, language: language === "hi" ? "Hindi" : language === "te" ? "Telugu" : "English" }) });
      if (request.isCurrent()) { setTriage(value); setDoctors(value.priority === "EMERGENCY" ? [] : value.doctors); setDiscoveryMessage(value.message); }
    } catch (e) {
      if (request.isCurrent()) { setError(`${e instanceof Error ? e.message : "AI guidance is unavailable."} You can browse verified doctors by specialty below.`); setManual(true); }
    } finally { if (request.isCurrent()) setAnalyzing(false); }
  };
  const discover = async (specialty: string) => {
    const request = guidance.start(); clearSelection(); setManual(true); setManualSpecialty(specialty); setTriage(null); setDoctors([]); setDiscoveryMessage(""); setError(""); setAnalyzing(Boolean(specialty));
    if (!specialty) { setAnalyzing(false); return; }
    try {
      const value = await apiRequest<Doctor[]>(`/api/appointments/doctors?specialty=${encodeURIComponent(specialty)}`, { signal: request.signal });
      if (request.isCurrent()) { setDoctors(value); setDiscoveryMessage(!value.length ? NO_MATCH : value.length === 1 ? "Only one matching verified doctor currently has an eligible slot within the next 14 days." : ""); }
    } catch (e) { if (request.isCurrent()) setError(e instanceof Error ? e.message : "Doctor discovery is unavailable. Please try again."); }
    finally { if (request.isCurrent()) setAnalyzing(false); }
  };
  const reset = () => { changeProblem(""); setRescheduling(null); };
  const finish = async () => {
    if (!doctorId || !slot || emergency || working) return;
    if (!rescheduling && (!problem.trim() || !doctors.some((doctor) => doctor._id === doctorId) || (!triage && !manual))) { setError("Describe your concern and select a verified doctor and time."); return; }
    setWorking(true); setError("");
    try {
      if (rescheduling) await apiRequest(`/api/appointments/${rescheduling._id}/reschedule`, { method: "PATCH", body: JSON.stringify({ startAt: slot.startAt, durationMinutes: slot.durationMinutes, appointmentVersion: rescheduling.__v ?? 0 }) });
      else {
        const payload = { doctor: doctorId, problem, startAt: slot.startAt, durationMinutes: slot.durationMinutes, priority: triage?.priority.toLowerCase() || "normal", aiSummary: triage?.summary || "" };
        const signature = JSON.stringify(payload);
        if (bookingRequest.current?.signature !== signature) bookingRequest.current = { signature, id: crypto.randomUUID() };
        await apiRequest("/api/appointments", { method: "POST", body: JSON.stringify({ ...payload, requestId: bookingRequest.current.id }) });
      }
      const message = rescheduling ? "Appointment rescheduled." : "Appointment booked."; reset(); setNotice(message); await loadItems();
    } catch (e) { setError(e instanceof Error ? e.message : "We could not save this appointment. Refresh availability and try again."); }
    finally { setWorking(false); }
  };
  const cancel = async () => {
    if (!cancelling || working) return; setWorking(true);
    try { await apiRequest(`/api/appointments/${cancelling._id}/cancel`, { method: "PATCH", body: JSON.stringify({ appointmentVersion: cancelling.__v ?? 0 }) }); setNotice("Appointment cancelled."); setCancelling(null); await loadItems(); }
    catch (e) { setError(e instanceof Error ? e.message : "We could not cancel this appointment."); } finally { setWorking(false); }
  };
  const beginReschedule = (appointment: Appointment) => {
    if (!appointment.doctor?._id) { setError("The assigned doctor is no longer available."); return; }
    if (working) return;
    reset(); setRescheduling(appointment); setDoctorId(appointment.doctor._id); window.scrollTo({ top: 0, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const upcoming = useMemo(() => items.filter((item) => item.status === "scheduled" && item.startAt && new Date(item.startAt) > new Date()), [items]);
  const history = useMemo(() => items.filter((item) => !upcoming.includes(item)), [items, upcoming]);
  return <div className="mf-page"><PageHeader eyebrow="Care scheduling" title="Appointments" description="Find a matching care professional and choose a time that works for you."/>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    <Surface className="overflow-hidden p-5 sm:p-7"><BookingProgress step={slot?4:doctorId?3:(triage||manualSpecialty)?2:1}/><fieldset disabled={working} className="contents">{rescheduling ? <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Choose a new time with {rescheduling.doctor.name}</h2><Button variant="ghost" disabled={working} onClick={reset}>Cancel reschedule</Button></div> : <>
      <h2 className="text-xl font-semibold tracking-tight">Let’s find your next step</h2><p className="mt-1 text-sm text-slate-500">Share only what is needed to guide your appointment. For emergencies, seek immediate local emergency care.</p>
      <label htmlFor="booking-concern" className="mf-label mt-5">Your health concern</label><textarea id="booking-concern" aria-label="Health concern" rows={4} maxLength={2000} value={problem} disabled={working} onChange={(e) => changeProblem(e.target.value)} className="mf-field mt-2 min-h-32 resize-y" placeholder="Describe your symptoms or health concern"/>
      <Button onClick={() => void analyze()} loading={analyzing && !manual} disabled={!problem.trim() || working} className="mt-3"><Sparkles size={16}/>Get guidance</Button>
      {triage && <div role={emergency ? "alert" : "status"} className={`mt-6 rounded-xl border p-5 ${emergency ? "border-red-200 bg-red-50" : "border-blue-100 bg-blue-50/50"}`}><div className="flex flex-wrap gap-2"><Badge tone="ai">{triage.guidanceSource==="local-safety-rule"?"Safety guidance":"AI guidance"}</Badge><Badge tone={emergency ? "danger" : triage.priority === "URGENT" ? "warning" : "info"}>{triage.priority}</Badge>{triage.specialties.map((value) => <Badge key={value}>{value}</Badge>)}</div><p className="mt-4 text-sm leading-6">{triage.summary}</p><p className="mt-2 text-sm font-semibold">{triage.recommendation}</p><p className="mt-3 text-xs text-slate-600">Assistive triage only, not a diagnosis. Do not wait for a routine appointment if symptoms are severe or worsening.</p></div>}
      {!emergency && <label className="mf-label mt-6 max-w-md">Browse by specialty without AI<select aria-label="Manual doctor specialty" disabled={working} value={manualSpecialty} onChange={(e) => void discover(e.target.value)} className="mf-field"><option value="">Choose a specialty</option>{specialties.map((value) => <option key={value}>{value}</option>)}</select></label>}
      {!emergency && (analyzing ? <p role="status" className="mt-5 text-sm text-slate-500">Checking guidance and availability...</p> : <>{discoveryMessage && <p role="status" className="mt-5 text-sm text-slate-700">{discoveryMessage}</p>}{(triage || manualSpecialty) && <DoctorStep doctors={doctors} selected={doctorId} choose={(id) => { clearSelection(); setDoctorId(id); }}/>}</>)}
    </>}
    {doctorId && !emergency && <TimeStep date={date} setDate={(value) => { slotRequests.invalidate(); setDate(value); setSlot(null); setSlots([]); }} slots={slots} slot={slot} setSlot={setSlot} loading={slotsLoading}/>}
    {slot && !emergency && <div className="mt-7 flex flex-col justify-between gap-4 rounded-xl bg-slate-50 p-5 sm:flex-row sm:items-center"><div><p className="text-xs font-semibold uppercase text-slate-500">Review</p><p className="mt-1 font-semibold">{doctors.find((doctor) => doctor._id === doctorId)?.name || rescheduling?.doctor.name}</p><p className="mt-1 text-sm">{new Date(slot.startAt).toLocaleString()} · {slot.durationMinutes} minutes</p><p className="mt-1 text-xs text-slate-500">Availability is rechecked when booking.</p></div><div className="flex gap-2"><Button variant="ghost" disabled={working} onClick={reset}>Start over</Button><Button loading={working} disabled={!rescheduling && !problem.trim()} onClick={() => void finish()}>{rescheduling ? "Confirm new time" : "Book appointment"}</Button></div></div>}
    </fieldset></Surface><AppointmentList title="Upcoming" items={upcoming} loading={loading} onReschedule={beginReschedule} onCancel={setCancelling}/><AppointmentList title="History" items={history} loading={loading}/>
    <ConfirmDialog open={Boolean(cancelling)} title="Cancel appointment?" danger busy={working} confirmLabel="Cancel appointment" onCancel={() => setCancelling(null)} onConfirm={() => void cancel()}>This appointment will move to your history. You can book another time later.</ConfirmDialog>
  </div>;
}
function DoctorStep({ doctors, selected, choose }: { doctors: Doctor[]; selected: string; choose: (id: string) => void }) {
  return <div className="mt-6"><h3 className="text-sm font-semibold">Choose your doctor</h3><p className="mt-1 text-xs text-slate-500">Matching specialties with an eligible slot in the next 14 days. Ordered by specialty relevance, then next available time.</p>
    {!doctors.length ? <EmptyState title={NO_MATCH} description="Select another specialty manually, or seek care through another qualified healthcare provider."/> : <div className="mt-3 grid gap-3 lg:grid-cols-2">{doctors.map((doctor) => <button type="button" aria-pressed={selected===doctor._id} onClick={() => choose(doctor._id)} key={doctor._id} className={`mf-patient-record flex gap-4 rounded-2xl border p-5 text-left ${selected === doctor._id ? "border-brand-700 bg-brand-50/50 ring-1 ring-brand-700" : "border-slate-200"}`}><Avatar name={doctor.name}/><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="text-base">{doctor.name}</strong>{selected===doctor._id&&<Badge tone="info">Selected</Badge>}{doctor.isRecommended && <Badge tone="success">Specialty match</Badge>}</span><span className="mt-1 block text-xs font-medium text-brand-700">{doctor.specialty}</span><span className="mt-2 block text-xs text-slate-600">{doctor.recommendationReason}</span><span className="mt-2 block text-xs text-slate-500">{doctor.qualifications?.length ? doctor.qualifications.join(", ") : "Qualifications not listed"}<br/>{doctor.languages?.join(", ")} · Consultation fee: ₹{doctor.consultationFee}<br/>Next available: {new Date(doctor.nextAvailableAt).toLocaleString()}</span></span></button>)}</div>}
  </div>;
}
function TimeStep({ date, setDate, slots, slot, setSlot, loading }: { date: string; setDate: (value: string) => void; slots: Slot[]; slot: Slot | null; setSlot: (value: Slot) => void; loading: boolean }) {
  return <div className="mt-8"><h3 className="text-base font-semibold">Select an available time</h3><p className="mt-1 text-sm text-slate-600">Times are shown in your device?s timezone. Availability is checked again when you book.</p><input aria-label="Appointment date" type="date" min={new Date().toLocaleDateString("en-CA")} value={date} onChange={(e) => setDate(e.target.value)} className="mf-field mt-3 max-w-xs"/>{date && <div className="mt-4 flex flex-wrap gap-2">{loading ? <p role="status" className="text-sm">Loading available times...</p> : slots.length ? slots.map((value) => <button key={value.startAt} aria-pressed={slot?.startAt===value.startAt} onClick={() => setSlot(value)} className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold ${slot?.startAt === value.startAt ? "border-brand-700 bg-brand-700 text-white" : "border-slate-200 bg-white text-slate-600"}`}><Clock size={13}/>{new Date(value.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</button>) : <p className="text-sm text-slate-500">No available times on this date.</p>}</div>}</div>;
}
function AppointmentList({ title, items, loading, onReschedule, onCancel }: { title: string; items: Appointment[]; loading: boolean; onReschedule?: (item: Appointment) => void; onCancel?: (item: Appointment) => void }) {
  return <section><div className="mb-4 flex items-center gap-3"><h2 className="text-lg font-semibold">{title}</h2>{!loading&&<Badge>{items.length}</Badge>}</div><Surface>{loading ? <p role="status" className="p-6 text-sm text-slate-500">Loading appointments...</p> : !items.length ? <EmptyState icon={<CalendarDays size={18}/>} title={`No ${title.toLowerCase()} appointments`} description={title === "Upcoming" ? "Your next booked consultation will appear here." : "Completed and cancelled appointments will appear here."}/> : <div>{items.map((item, index) => <article key={item._id} className={`flex flex-col justify-between gap-4 px-5 py-4 sm:flex-row sm:items-center ${index ? "border-t border-slate-100" : ""}`}><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{item.doctor?.name || "Doctor unavailable"}</h3><Badge tone={item.status === "completed" ? "success" : item.status === "cancelled" ? "neutral" : "info"}>{item.status}</Badge></div><p className="mt-1 text-xs text-brand-700">{item.doctor?.specialty || item.specialty}</p><p className="mt-2 text-sm text-slate-500">{item.startAt ? new Date(item.startAt).toLocaleString() : "Time unavailable"} · {item.problem}</p></div>{onReschedule && onCancel && <div className="flex flex-wrap gap-2"><Button variant="secondary" aria-label={`Reschedule appointment with ${item.doctor?.name||"assigned doctor"}`} onClick={() => onReschedule(item)}>Reschedule</Button><Button variant="ghost" className="text-red-700" aria-label={`Cancel appointment with ${item.doctor?.name||"assigned doctor"}`} onClick={() => onCancel(item)}>Cancel</Button></div>}</article>)}</div>}</Surface></section>;
}
function Notice({children,error=false}:{children:React.ReactNode;error?:boolean}){return <Feedback tone={error?"error":"success"}>{children}</Feedback>}
function BookingProgress({step}:{step:number}){return <ol aria-label="Booking progress" className="mb-7 grid grid-cols-2 gap-3 border-b border-slate-200 pb-6 md:grid-cols-4">{["Describe your concern","Choose a doctor","Choose a time","Review & book"].map((label,index)=><li key={label} aria-current={step===index+1?"step":undefined} className={`flex items-center gap-3 rounded-xl p-3 text-sm ${step===index+1?"bg-blue-50 font-semibold text-brand-700":"text-slate-600"}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${step>index+1?"bg-teal-100 text-teal-800":step===index+1?"bg-brand-700 text-white":"border border-slate-300 bg-white"}`}>{index+1}</span><span>{label}</span></li>)}</ol>}
