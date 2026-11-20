import React,{useEffect,useMemo,useState} from "react";
import {BrainCircuit,Plus,Send,Trash2,RefreshCw,ExternalLink,Activity,FileText} from "lucide-react";

const STORE="nexora:nvidia-research:sessions";
const welcome="Welcome to NVIDIA Deep Research. Start an investigation and follow its progress here. Completed reports can be used as context for follow-up investigations.";
const readSessions=()=>{try{const value=JSON.parse(localStorage.getItem(STORE)||"[]");return Array.isArray(value)?value:[];}catch{return [];}};
const makeSession=()=>({id:crypto.randomUUID(),title:"New research",messages:[{role:"assistant",text:welcome}],createdAt:Date.now(),updatedAt:Date.now()});
function reportText(report){if(typeof report==="string")return report;return report?.report||report?.content||report?.markdown||report?.result||JSON.stringify(report,null,2);}
function sourceLinks(report){const raw=report?.sources||report?.citations||report?.references||[];return Array.isArray(raw)?raw:[];}

export default function NvidiaResearchChat(){
 const [sessions,setSessions]=useState(readSessions);
 const [activeId,setActiveId]=useState(()=>{try{return localStorage.getItem(STORE+":active")||"";}catch{return "";}});
 const [draft,setDraft]=useState("");
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("Ready to research");
 const [progress,setProgress]=useState([]);
 const [error,setError]=useState("");
 const active=sessions.find(s=>s.id===activeId)||sessions[0]||null;
 const messages=active?.messages||[];
 useEffect(()=>{try{localStorage.setItem(STORE,JSON.stringify(sessions));if(active?.id)localStorage.setItem(STORE+":active",active.id);}catch{}},[sessions,active?.id]);
 useEffect(()=>{if(!active&&sessions.length===0){const fresh=makeSession();setSessions([fresh]);setActiveId(fresh.id);}},[active,sessions.length]);
 const update=(id,fn)=>setSessions(items=>items.map(s=>s.id===id?fn(s):s));
 const newResearch=()=>{const s=makeSession();setSessions(items=>[s,...items]);setActiveId(s.id);setDraft("");setProgress([]);setError("");setStatus("Ready to research");};
 const remove=(id)=>{const rest=sessions.filter(s=>s.id!==id);if(!rest.length){const fresh=makeSession();setSessions([fresh]);setActiveId(fresh.id);}else{setSessions(rest);if(activeId===id)setActiveId(rest[0].id);}};
 async function submit(event){
  event?.preventDefault();const question=draft.trim();if(!question||busy||!active)return;
  const sid=active.id;const prior=[...messages];const user={role:"user",text:question};
  update(sid,s=>({...s,title:s.messages.some(m=>m.role==="user")?s.title:question.slice(0,48),messages:[...s.messages,user],updatedAt:Date.now()}));
  setDraft("");setBusy(true);setError("");setProgress(["Submitting investigation to NVIDIA Deep Researcher…"]);setStatus("Planning investigation");
  let streamController;
  try{
   const previousReport=[...prior].reverse().find(m=>m.role==="report");
   const input=previousReport?"Follow-up question: "+question+"\n\nUse this previous research report as context. Verify any claims that need updating and provide fresh citations:\n"+previousReport.text.slice(0,24000):question;
   const response=await fetch("/api/research/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_type:"deep_researcher",input})});
   const submitted=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(submitted.detail?.message||submitted.error||"Research submission failed (HTTP "+response.status+").");
   const jobId=submitted.job_id;if(typeof jobId!=="string"||!jobId)throw new Error("Research service did not return a job ID.");
   update(sid,s=>({...s,jobId,updatedAt:Date.now()}));setStatus("Research agents are working");setProgress(p=>[...p,"Job "+jobId+" created"]);
   streamController=new AbortController();
   (async()=>{try{const stream=await fetch("/api/research/job/"+encodeURIComponent(jobId)+"/stream",{signal:streamController.signal});if(!stream.ok||!stream.body)return;const reader=stream.body.getReader(),decoder=new TextDecoder();let buffer="";while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const frames=buffer.split(/\r?\n\r?\n/);buffer=frames.pop()||"";for(const frame of frames){const data=(frame.match(/^data:\s*(.*)$/m)||[])[1];if(!data)continue;let value;try{value=JSON.parse(data);}catch{value={message:data};}const detail=value.status||value.message||value.agent_type||value.title||JSON.stringify(value);setProgress(p=>[...p.slice(-39),String(detail).slice(0,260)]);}}}catch(e){if(e.name!=="AbortError")setProgress(p=>[...p,"Live event stream interrupted; status polling continues."]);}})();
   let done=false;
   for(let i=0;i<120;i++){
    const check=await fetch("/api/research/job/"+encodeURIComponent(jobId));const data=await check.json().catch(()=>({}));
    if(check.ok){const state=String(data.status||data.job?.status||data.job_info?.status||"").toLowerCase();
     if(["success","completed","complete"].includes(state)){done=true;break;}
     if(["failure","failed","error","cancelled","interrupted"].includes(state))throw new Error(data.error||data.detail?.message||"Research ended with status: "+state);
     if(i===0||i%5===0){setStatus("Investigating · "+(i*2)+" seconds elapsed");setProgress(p=>[...p.slice(-39),"Job status: "+(state||"in progress")]);}
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   if(!done)throw new Error("Research is still running. The job ID is saved; reopen this session and refresh the report later.");
   streamController.abort();
   const reportResponse=await fetch("/api/research/job/"+encodeURIComponent(jobId)+"/report");const report=await reportResponse.json().catch(()=>({}));
   if(!reportResponse.ok)throw new Error(report.detail?.message||report.error||"The completed report could not be loaded.");
   const text=reportText(report);
   update(sid,s=>({...s,messages:[...s.messages,{role:"report",text,report}],updatedAt:Date.now()}));setStatus("Investigation completed");
  }catch(e){setError(e.message);setStatus("Investigation needs attention");}
  finally{streamController?.abort();setBusy(false);}
 }
 async function refresh(){if(!active?.jobId||busy)return;setBusy(true);setError("");try{const r=await fetch("/api/research/job/"+encodeURIComponent(active.jobId)+"/report");const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||"Report is not ready.");update(active.id,s=>({...s,messages:[...s.messages,{role:"report",text:reportText(data),report:data}],updatedAt:Date.now()}));setStatus("Report refreshed");}catch(e){setError(e.message);}finally{setBusy(false);}}
 const styles={};
 return <section className="stack nvidia-research-page">
 <div className="nvidia-research-shell">
  <aside className="nvidia-research-history"><button className="nvidia-research-new" onClick={newResearch}><Plus size={16}/> New Research</button><div className="nvidia-research-label">SAVED INVESTIGATIONS</div><div className="nvidia-research-sessions">{sessions.map(s=><div className={s.id===active?.id?"nvidia-research-session active":"nvidia-research-session"} key={s.id}><button onClick={()=>{setActiveId(s.id);setProgress([]);setError("");}}>{s.title}</button><button aria-label="Delete research session" onClick={()=>remove(s.id)}><Trash2 size={14}/></button></div>)}</div><small>Stored on this device · private browser history</small></aside>
  <div className="nvidia-research-main"><header className="nvidia-research-header"><span><BrainCircuit size={23}/></span><div><b>NVIDIA Deep Research</b><small>AGENT-BASED INVESTIGATION · CITED REPORTS</small></div><i>{busy?"RESEARCHING":"READY"}</i></header>
   <div className="nvidia-research-body">
    <div className="nvidia-research-intro"><h1>Research beyond a quick answer.</h1><p>Plan an investigation, discover sources, analyze evidence and assemble a detailed report. Follow-up questions use the previous report as context and launch a new verified research run.</p><div className="nvidia-research-capabilities"><span><Activity size={14}/> Live activity</span><span><FileText size={14}/> Evidence report</span><span><ExternalLink size={14}/> Source citations</span></div></div>
    {messages.map((m,i)=><article className={"nvidia-research-message "+m.role} key={i}><b>{m.role==="user"?"YOU":m.role==="report"?"RESEARCH REPORT":"NVIDIA RESEARCH"}</b>{m.role==="report"?<><pre>{m.text}</pre><div className="nvidia-research-sources">{sourceLinks(m.report).map((source,j)=>{const url=typeof source==="string"?source:source.url||source.link;const label=typeof source==="string"?source:source.title||source.name||url;return url&&/^https?:\/\//i.test(url)?<a key={j} href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={12}/></a>:null;})}</div></>:<p>{m.text}</p>}</article>)}
    {(busy||progress.length>0)&&<article className="nvidia-research-activity"><b><Activity size={15}/> LIVE RESEARCH ACTIVITY</b><p>{status}</p><ol>{progress.map((item,i)=><li key={i}>{item}</li>)}</ol></article>}
    {error&&<p className="nvidia-research-error" role="alert">{error}</p>}
   </div>
   <div className="nvidia-research-compose">{active?.jobId&&<button className="nvidia-research-refresh" onClick={refresh} disabled={busy}><RefreshCw size={14}/> Refresh report</button>}<form onSubmit={submit}><textarea rows="3" maxLength="32768" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="What should NVIDIA Deep Research investigate? Add scope, questions, timeframe and evidence requirements…" onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form.requestSubmit();}}}/><div><small>Enter to investigate · Shift + Enter for a new line</small><button disabled={!draft.trim()||busy}><Send size={16}/> {busy?"Working…":"Start research"}</button></div></form><small>Research history is saved locally in this browser. Cloud-synced sessions require a configured persistent account store.</small></div>
  </div>
 </div></section>;
}
