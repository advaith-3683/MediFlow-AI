import{useEffect,useRef,useState}from"react";import{ArrowUp,ArrowUpRight,ShieldAlert,Sparkles}from"lucide-react";import{apiRequest}from"../../api/client";import{LanguageSelect,useI18n}from"../../i18n/I18nContext";import{Badge,Notice,PageHeader,Surface}from"../../components/ui/Core";
import { createLatestRequest } from "../../api/latestRequest";
interface Message{sender:"user"|"ai";text:string;aiGenerated?:boolean}const prompts=["How can I prepare for a doctor appointment?","What information should I track about a headache?","Explain common fever self-care guidance"];
export default function AIChatPage() {
  const { language } = useI18n();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [chat, setChat] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [requests] = useState(createLatestRequest);
  const pending = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Some browser implementations return a Promise. Never return it as cleanup.
    void Promise.resolve(end.current?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })).catch(() => {});
  }, [chat, loading]);

  useEffect(() => {
    setLoading(false);
    return () => {
      requests.invalidate();
      pending.current = false;
    };
  }, [language, requests]);

  const send = async () => {
    const text = message.trim();
    if (!text || pending.current) return;
    pending.current = true;
    const request = requests.start();
    setChat(value => [...value, { sender: "user", text }]);
    setMessage("");
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<{ reply: string; aiGenerated?: boolean }>("/api/ai/chat", {
        method: "POST",
        signal: request.signal,
        body: JSON.stringify({ message: text, language: language === "hi" ? "Hindi" : language === "te" ? "Telugu" : "English" }),
      });
      if (request.isCurrent()) setChat(value => [...value, { sender: "ai", text: data.reply, aiGenerated: data.aiGenerated !== false }]);
    } catch (error) {
      if (request.isCurrent()) setError(error instanceof Error ? error.message : "MediFlow AI is temporarily unavailable.");
    } finally {
      if (request.isCurrent()) {
        pending.current = false;
        setLoading(false);
      }
    }
  };return <div className="mf-page"><PageHeader eyebrow="A little guidance, a clearer next step" title="Health assistant" description="Ask questions, explore general health information and prepare for professional care."/>
    <Surface className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7"><div className="flex items-center gap-3"><span className="mf-document-icon"><Sparkles size={22} aria-hidden="true"/></span><div><h2 className="text-sm font-semibold">MediFlow assistant</h2><p className="mt-0.5 text-xs text-slate-600">Educational guidance | Not a clinician</p></div></div><LanguageSelect/></div>
    <div className="mf-chat-thread max-h-[62dvh] min-h-[320px] overflow-y-auto px-5 py-7 sm:px-10"><div className="mx-auto max-w-3xl"><div role="log" aria-label="Health assistant conversation" aria-live="polite" aria-relevant="additions" className="space-y-6">{chat.length===0&&<Welcome onPrompt={setMessage}/>}{chat.map((item,index)=><article key={index} className={`flex gap-3 ${item.sender==="user"?"justify-end":"justify-start"}`}>{item.sender==="ai"&&<span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700"><Sparkles size={17} aria-hidden="true"/></span>}<div data-message={item.sender} className={item.sender==="user"?"max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#173f7a] px-5 py-3.5 text-[15px] leading-7 text-white":"min-w-0 max-w-[90%] rounded-2xl rounded-tl-md border border-slate-200 bg-slate-50/70 p-5 text-[15px] leading-7 text-slate-800"}>{item.sender==="ai"&&<div className="mb-3"><Badge tone="ai">{item.aiGenerated===false?"Safety guidance":"AI-generated guidance"}</Badge></div>}{item.text}</div></article>)}</div>{loading&&<div role="status" className="mt-6 flex items-center gap-3 text-sm text-slate-600"><span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 text-teal-700"><Sparkles size={17} aria-hidden="true"/></span><span>Preparing your guidance<span className="motion-safe:animate-pulse" aria-hidden="true">...</span></span></div>}{error&&<div className="mt-5"><Notice tone="error">{error} Try again shortly.</Notice></div>}<div ref={end}/></div></div>
    <div className="border-t border-slate-200 bg-white px-5 py-5 sm:px-8"><div className="mx-auto max-w-3xl"><label htmlFor="health-message" className="sr-only">Message MediFlow AI</label><div className="flex items-end gap-3 rounded-2xl border border-slate-300 p-2.5 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100"><textarea id="health-message" aria-label="Message MediFlow AI" rows={2} maxLength={4000} value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send()}}} placeholder="What would you like to understand about your health?" className="max-h-40 min-h-14 min-w-0 flex-1 resize-y border-0 bg-transparent px-2 py-1 text-[15px] leading-7 outline-none"/><button onClick={()=>void send()} disabled={!message.trim()||loading} aria-label="Send message" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-700 text-white transition hover:bg-brand-800 disabled:bg-slate-200 disabled:text-slate-500"><ArrowUp size={20} aria-hidden="true"/></button></div><div className="mt-3 flex flex-wrap justify-between gap-2 text-xs leading-6 text-slate-600"><p>Avoid names, contact details and record identifiers.</p><p>{message.length}/4000 | Shift + Enter for a new line</p></div></div></div></Surface>
    <Notice tone="warning"><span className="font-semibold">Not for emergencies.</span> Seek immediate local emergency care for severe or worsening symptoms. Do not rely on this assistant or appointment booking. AI can make mistakes; this is not a diagnosis.</Notice>
  </div>}
function Welcome({onPrompt}:{onPrompt:(value:string)=>void}){return <div className="mx-auto max-w-2xl py-5 sm:py-8"><span className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-teal-700"><ShieldAlert size={18} aria-hidden="true"/>A thoughtful starting point</span><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What's on your mind?</h2><p className="mt-3 max-w-lg text-[15px] leading-7 text-slate-600">You don't need to have all the answers. Start with a question about symptoms, everyday health or your next visit.</p><div className="mt-7 grid gap-3">{prompts.map(prompt=><button key={prompt} onClick={()=>onPrompt(prompt)} className="mf-chat-prompt flex items-center justify-between gap-4 text-sm font-medium text-slate-700"><span>{prompt}</span><ArrowUpRight size={18} aria-hidden="true" className="shrink-0 text-teal-700"/></button>)}</div></div>}
