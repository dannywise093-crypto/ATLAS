import React, { useEffect, useState } from "react";
import { runAtlasCore } from "./atlasCore.js";
import { getNeuralRuntimeStatus, checkAtlasBackend, generateAtlasResponse } from "./modelRuntime.js";
import { Activity, Bot, BrainCircuit, Camera, Database, Eye, GraduationCap, Home, Menu, MessageSquare, Mic, Radio, Send, Settings, ShieldCheck, Sparkles, Volume2, X, Terminal, Play, Plus, ChevronDown, AudioLines, PencilLine, Zap, Copy, Share2, ThumbsUp, ThumbsDown, RefreshCw } from "lucide-react";

function SyntaxCode({ language, code }) {
  const keywordSource = ({
    python:"False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self",
    cpp:"alignas auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for friend if inline int long namespace new nullptr private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while",
    javascript:"async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null return static super switch this throw true try typeof undefined var void while with yield",
    typescript:"abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function if implements import in infer instanceof interface keyof let module namespace never new null number object private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while with",
    java:"abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while"
  })[String(language).toLowerCase()] || "";
  const keywords = new Set(keywordSource.split(/\\s+/));
  const pattern = /(\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  const chunks=[]; let last=0, match, index=0;
  while((match=pattern.exec(code))!==null){
    if(match.index>last) chunks.push(code.slice(last,match.index));
    const token=match[0];
    let cls="syntax-plain";
    if(token.startsWith("//")||token.startsWith("#")) cls="syntax-comment";
    else if(token.startsWith("\"")||token.startsWith("'")) cls="syntax-string";
    else if(/^\d/.test(token)) cls="syntax-number";
    else if(keywords.has(token)) cls="syntax-keyword";
    else if(/^[A-Za-z_$]/.test(token)&&/^\s*\(/.test(code.slice(pattern.lastIndex))) cls="syntax-function";
    chunks.push(<span className={cls} key={index++}>{token}</span>);
    last=pattern.lastIndex;
  }
  if(last<code.length) chunks.push(code.slice(last));
  return <code>{chunks}</code>;
}
function CodeBlock({ language, code }) {
  const [copied,setCopied]=useState(false);
  async function copyCode(){
    try{await navigator.clipboard.writeText(code);setCopied(true);}
    catch{
      const area=document.createElement("textarea");area.value=code;area.style.position="fixed";area.style.opacity="0";
      document.body.appendChild(area);area.select();setCopied(document.execCommand("copy"));area.remove();
    }
    window.setTimeout(()=>setCopied(false),1600);
  }
  return <section className="assistant-code">
    <header className="assistant-code-head">
      <span className="assistant-code-language"><Terminal size={16}/>{language||"Code"}</span>
      <button type="button" className="assistant-code-copy" onClick={copyCode} aria-label="Copy code" title="Copy code">
        {copied?"Copied":<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 5V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h1"/></svg>}
      </button>
    </header>
    <pre><SyntaxCode language={language} code={code}/></pre>
  </section>;
}
function InlineText({ text }) {
  const pieces=text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <>{pieces.map((part,i)=>part.startsWith("**")?<strong key={i}>{part.slice(2,-2)}</strong>:part.startsWith("`")?<code className="inline-code" key={i}>{part.slice(1,-1)}</code>:part)}</>;
}
function AssistantMessage({ text }) {
  const parts=[]; const fence=/```([\w+#.-]*)[^\S\r\n]*\r?\n([\s\S]*?)```/g;
  let last=0,match,index=0;
  while((match=fence.exec(text))!==null){
    if(match.index>last) parts.push(<div className="assistant-prose" key={"prose-"+index}>{renderProse(text.slice(last,match.index))}</div>);
    parts.push(<CodeBlock key={"code-"+index} language={match[1]} code={match[2].replace(/\n$/,"")}/>);
    last=fence.lastIndex; index++;
  }
  if(last<text.length) parts.push(<div className="assistant-prose" key={"prose-"+index}>{renderProse(text.slice(last))}</div>);
  return <>{parts.length?parts:<div className="assistant-prose">{renderProse(text)}</div>}</>;
}
function renderProse(value){
  return value.trim().split(/\n{2,}/).filter(Boolean).map((block,i)=>{
    const lines=block.split("\n");
    if(lines.every(line=>/^\s*[-*•]\s+/.test(line))) return <ul key={i}>{lines.map((line,j)=><li key={j}><InlineText text={line.replace(/^\s*[-*•]\s+/,"")}/></li>)}</ul>;
    if(/^#{1,4}\s/.test(lines[0])) return <div className="assistant-heading" key={i}><b>{lines[0].replace(/^#{1,4}\s/,"")}</b>{lines.length>1&&<p><InlineText text={lines.slice(1).join("\n")}/></p>}</div>;
    return <p key={i}><InlineText text={block}/></p>;
  });
}
function AtlasLogo({ className = "" }) {
  return <img className={className} src="/atlas-logo.svg" alt="ATLAS logo" />;
}

const initial = [
  { role: "atlas", text: "ATLAS is connected to Cloudflare Workers AI using the GLM-4.7-Flash open-weight foundation model. Local project memory remains available on this device." },
  { role: "atlas", text: "Try saying “help” or “Remember that ATLAS is my personal AI project.”" }
];
const nav = [["Overview",Home],["AI Assistant",MessageSquare],["Code Lab",Terminal],["Vision Center",Eye],["Voice Center",Mic],["Memory",Database],["Learning",GraduationCap],["Robotics",Bot],["Settings",Settings]];

export default function App() {
  const [page,setPage] = useState("Overview");
  const [messages,setMessages] = useState(()=>{try{return JSON.parse(localStorage.getItem("atlas-messages"))||initial}catch{return initial}});
  const [memory,setMemory] = useState(()=>{try{return JSON.parse(localStorage.getItem("atlas-memory"))||["ATLAS is a general-purpose Physical AI project.","Architecture preference: hybrid cloud and local computing."]}catch{return []}});
  const [input,setInput] = useState("");
  const [assistantTab,setAssistantTab] = useState("Ask");
  const [image,setImage] = useState("");
  const [menu,setMenu] = useState(false);
  const [notice,setNotice] = useState("");
  const [generating,setGenerating] = useState(false);
  const [gatewayReady,setGatewayReady] = useState(false);
  const [gatewayMessage,setGatewayMessage] = useState("Checking the hosted model gateway…");
  const [pythonCode,setPythonCode] = useState("import unittest\n\ndef factorial(n):\n    if type(n) is not int:\n        raise TypeError(\"n must be an integer\")\n    if n < 0:\n        raise ValueError(\"n must be non-negative\")\n    return 1 if n < 2 else n * factorial(n - 1)\n\nclass FactorialTests(unittest.TestCase):\n    def test_five(self): self.assertEqual(factorial(5), 120)\n    def test_seven(self): self.assertEqual(factorial(7), 5040)\n    def test_ten(self): self.assertEqual(factorial(10), 3628800)\n    def test_negative(self):\n        with self.assertRaises(ValueError): factorial(-1)\n    def test_float(self):\n        with self.assertRaises(TypeError): factorial(2.5)\n\nif __name__ == \"__main__\":\n    print(\"5! =\", factorial(5))\n    print(\"7! =\", factorial(7))\n    print(\"10! =\", factorial(10))\n    unittest.main(argv=[\"ignored\"], verbosity=2, exit=False)\n");
  const [pythonResult,setPythonResult] = useState(null);
  const [runningPython,setRunningPython] = useState(false);

  useEffect(()=>{const controller=new AbortController();checkAtlasBackend(controller.signal).then(status=>{const ready=status.status==="configured";setGatewayReady(ready);setGatewayMessage(ready?"Cloudflare Workers AI · GLM-4.7-Flash is connected.":"The hosted model is not configured.");}).catch(error=>{setGatewayReady(false);setGatewayMessage(error.message);});return()=>controller.abort();},[]);
  useEffect(()=>localStorage.setItem("atlas-messages",JSON.stringify(messages)),[messages]);
  useEffect(()=>localStorage.setItem("atlas-memory",JSON.stringify(memory)),[memory]);
  async function send(e){
    e.preventDefault();
    const value=input.trim();
    if(!value||generating)return;
    const userMessage={role:"user",text:value};
    const nextMessages=[...messages,userMessage];
    setMessages(nextMessages);
    setInput("");
    const localCommand=/^(remember that|remember|save this|store this|what do you remember|show memory|list memories|my memories|find |search memory for |do you remember |help$|roadmap$|development plan$)/i.test(value);
    if(localCommand){
      const result=runAtlasCore(value,memory,messages);
      if(result.action==="save_memory"&&result.memory){
        setMemory(items=>items.includes(result.memory)?items:[...items,result.memory]);
      }
      setMessages(items=>[...items,{role:"atlas",text:result.text}]);
      return;
    }
    setGenerating(true);
    try{
      const reply=await generateAtlasResponse(nextMessages);
      setMessages(items=>[...items,{role:"atlas",text:reply}]);
    }catch(error){
      setMessages(items=>[...items,{role:"atlas",text:`I couldn't reach the ATLAS language-model service. ${error.message} Your message remains in this chat. The local notes and memory commands still work, but I won't pretend the rule-based core generated a general AI answer.`}]);
    }finally{
      setGenerating(false);
    }
  }
  async function runPython(){
    if(runningPython||!pythonCode.trim())return;
    setRunningPython(true);setPythonResult(null);
    try{
      const response=await fetch("/api/execute",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:pythonCode,auto_repair:true})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Python execution request failed.");
      setPythonResult(data);
      if(data.code&&data.code!==pythonCode)setPythonCode(data.code);
    }catch(error){setPythonResult({status:"unavailable",execution_verified:false,error:error.message,output:"",attempts:[]});}
    finally{setRunningPython(false);}
  }
  function addMemory(){const v=prompt("What should ATLAS save in project memory?");if(v?.trim())setMemory(m=>[...m,v.trim()])}
  function heading(title,sub,badge){return <header className="pagehead"><div className="headicon"><AtlasLogo className="logo-head"/></div><div><div className="headrow"><h1>{title}</h1>{badge&&<span className="badge">{badge}</span>}</div><p>{sub}</p></div></header>}
  function card(icon,title,desc,status="Planned"){return <article className="card"><div className="cardtop"><span className="cardicon">{icon}</span><span className="badge">{status}</span></div><h3>{title}</h3><p>{desc}</p></article>}
  const neuralStatus = {...getNeuralRuntimeStatus(),available:gatewayReady,reason:gatewayMessage};
  const content = page==="Overview" ? <section className="stack">
    <div className="hero"><div className="eyebrow"><AtlasLogo className="hero-logo"/> PROJECT WORKSPACE · V1.1</div><h1>Build intelligence<br/><em>that can act in the real world.</em></h1><p>ATLAS is a modular foundation for conversational AI, perception, learning and safe robotics integration.</p><button onClick={()=>setPage("AI Assistant")}> <MessageSquare size={16}/> Open AI assistant</button></div>
    <h2>SYSTEM OVERVIEW</h2><div className="grid four">{card(<BrainCircuit/>,"AI Core","Local intent engine connected","Local v0.2")}{card(<Sparkles/>,"Neural Runtime",neuralStatus.reason,neuralStatus.available?"Ready":"Not installed")}{card(<Database/>,"Project Memory",memory.length+" notes on this device","Local")}{card(<Eye/>,"Vision","Image preview only","Standby")}{card(<Bot/>,"Robotics","No hardware connected","Offline")}</div>
    <h2>DEVELOPMENT MODULES</h2><div className="grid two">{card(<MessageSquare/>,"Conversational intelligence","Hosted GLM-4.7-Flash foundation model through Cloudflare Workers AI.","Interface ready")}{card(<Eye/>,"Perception & vision","Prepare image inputs for future computer vision.","Preview ready")}{card(<GraduationCap/>,"Learning system","Plan supervised demonstrations and evaluation.","Planned")}{card(<Bot/>,"Robotics integration","A safe bridge to controllers after simulation and testing.","Not connected")}</div>
    <div className="safety"><ShieldCheck/><div><b>Safety-first development</b><p>This is a software prototype. It does not control physical devices. Real robot movement must use independent safety limits and supervised testing.</p></div></div>
  </section> : page==="AI Assistant" ? <section className="atlas-chat-screen">
    <header className="atlas-chat-top">
      <button className="atlas-top-icon" onClick={()=>setMenu(true)} aria-label="Open menu"><Menu/></button>
      <nav className="atlas-tabs"><button className={assistantTab==="Ask"?"selected":""} onClick={()=>setAssistantTab("Ask")}>Ask</button><button className={assistantTab==="Imagine"?"selected":""} onClick={()=>{setAssistantTab("Imagine");setNotice("Imagine mode is not connected yet.");}}>Imagine</button></nav>
      <button className="atlas-top-icon" aria-label="New chat" onClick={()=>{setMessages(initial);setNotice("");}}><PencilLine/></button>
    </header>
    <div className="atlas-conversation" ref={el=>{if(el)el.scrollTop=el.scrollHeight;}}>
      {messages.map((m,i)=><article className={"atlas-message "+(m.role==="user"?"from-user":"from-atlas")} key={i}>
        {m.role==="atlas"&&i===0&&<span className="atlas-message-label">ATLAS</span>}
        <AssistantMessage text={m.text}/>
        {m.role==="atlas"&&i===messages.length-1&&!generating&&<div className="atlas-message-actions">
          <button aria-label="Copy response" title="Copy response" onClick={()=>navigator.clipboard?.writeText(m.text)}><Copy/></button>
          <button aria-label="Share response" title="Share response" onClick={()=>{if(navigator.share)navigator.share({text:m.text}).catch(()=>{});else setNotice("Sharing is not available in this browser.");}}><Share2/></button>
          <button aria-label="Helpful" title="Helpful" onClick={()=>setNotice("Thanks for your feedback.")}><ThumbsUp/></button>
          <button aria-label="Not helpful" title="Not helpful" onClick={()=>setNotice("Feedback noted.")}><ThumbsDown/></button>
          <button aria-label="Speak response" title="Speak response" onClick={()=>{if("speechSynthesis"in window){window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance(m.text));}}}><Volume2/></button>
          <button aria-label="Regenerate response" title="Regenerate response" onClick={()=>{const prior=messages.slice(0,i);const lastUser=[...prior].reverse().find(x=>x.role==="user");if(lastUser){setMessages(prior);setInput(lastUser.text);setNotice("Tap Send to regenerate this response.");}}}><RefreshCw/></button>
        </div>}
      </article>)}
      {generating&&<article className="atlas-message from-atlas"><span className="atlas-message-label">ATLAS</span><p className="typing">ATLAS is thinking…</p></article>}
    </div>
    <div className="atlas-composer-wrap">
      {notice&&<div className="atlas-chat-notice">{notice}</div>}
      <form className="atlas-composer" onSubmit={send}>
        <button type="button" className="atlas-composer-plus" aria-label="More options" onClick={()=>setNotice("Attachments are not connected in this chat yet.")}><Plus/></button>
        <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Ask anything" aria-label="Message ATLAS"/>
        <button type="button" className="atlas-mode" onClick={()=>setNotice("Fast response mode · Cloudflare Workers AI")}><Zap size={17}/> Fast <ChevronDown size={15}/></button>
        <button type="button" className="atlas-mic" aria-label="Voice input" onClick={()=>setNotice("Voice input is not connected yet.")}><Mic/></button>
        <button type="button" className="atlas-speak" onClick={()=>{const last=[...messages].reverse().find(m=>m.role==="atlas");if(last&&"speechSynthesis"in window){window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance(last.text));}else setNotice("There is no ATLAS response to speak yet.");}}><AudioLines size={18}/> Speak</button>
        <button type="submit" className="atlas-send" disabled={!input.trim()||generating} aria-label="Send message"><Send/></button>
      </form>
      <small>{generating?"ATLAS is generating a response…":"ATLAS · Cloudflare Workers AI"}</small>
    </div>
  </section>
  : page==="Code Lab" ? <section className="stack">{heading("Python Code Lab","Run Python in ATLAS, capture real output, and request one automatic repair.","RESTRICTED RUNNER")}<div className="code-panel"><div className="code-toolbar"><span><Terminal size={15}/> Python 3 · Restricted execution</span><button onClick={runPython} disabled={runningPython||!pythonCode.trim()}><Play size={15}/>{runningPython?"Running…":"Run & verify"}</button></div><textarea className="code-editor" spellCheck="false" value={pythonCode} onChange={e=>setPythonCode(e.target.value)} aria-label="Python source code"/><p className="code-hint">Maximum 20,000 characters · 5-second runtime limit · standard-library allowlist · one AI repair attempt after a failed run.</p></div>{pythonResult&&<div className="execution-card"><div className="execution-heading"><b>Execution result</b><span className={"execution-status "+(pythonResult.execution_verified?"passed":"failed")}>{pythonResult.execution_verified?"EXECUTED · VERIFIED":"NOT VERIFIED"}</span></div><p className="execution-note">{pythonResult.execution_verified?"The server ran this code and captured the process output.":"The code did not complete successfully. Output below is only what the runner actually captured."}</p>{pythonResult.output&&<><label>STDOUT</label><pre>{pythonResult.output}</pre></>}{pythonResult.error&&<><label>STDERR / ERROR</label><pre className="stderr">{pythonResult.error}</pre></>}{pythonResult.attempts?.length>1&&<p className="code-hint">Automatic repair was attempted. {pythonResult.execution_verified?"The repaired version passed execution.":"The repaired version did not pass."}</p>}{pythonResult.security_note&&<p className="notice">{pythonResult.security_note}</p>}</div>}<div className="safety"><ShieldCheck/><div><b>Execution safety</b><p>ATLAS uses a restricted subprocess with time and resource limits. This is not yet a hardened isolation boundary for hostile code; do not submit secrets or sensitive files.</p></div></div></section>
  : page==="Vision Center" ? <section className="stack">{heading(page,"Prepare image input for future computer-vision features.","NOT CONNECTED")}<div className="panel"><Camera size={30}/><h3>Image input</h3><p>Choose a picture from your phone to preview it here. This prototype does not send images to an AI model.</p><label className="button">Choose image<input hidden type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f){setImage(URL.createObjectURL(f));setNotice("Local preview only. AI analysis is not connected.")}}}/></label>{image&&<img className="preview" src={image} alt="Selected preview"/>}{notice&&<p className="notice">{notice}</p>}</div>{card(<ShieldCheck/>,"Planned vision capabilities","Object recognition, camera integration, visual Q&A and privacy controls.")}</section>
  : page==="Voice Center" ? <section className="stack">{heading(page,"Voice interaction will be added after the AI backend.","COMING NEXT")}<div className="panel"><Mic size={36}/><h3>Voice interface</h3><p>Microphone capture and spoken responses are not connected yet. Permissions will be requested only when implemented.</p><button onClick={()=>setNotice("Voice features are planned for a later milestone.")}><Volume2 size={16}/> Check status</button>{notice&&<p className="notice">{notice}</p>}</div></section>
  : page==="Memory" ? <section className="stack">{heading("Project Memory","Notes are stored in this browser on this device.")}<div className="toolbar"><span>{memory.length} saved notes</span><button onClick={addMemory}>+ Add memory</button></div>{memory.map((m,i)=><div className="memory" key={i}><Database/><p>{m}</p><button className="delete" onClick={()=>setMemory(a=>a.filter((_,n)=>n!==i))}>Delete</button></div>)}<p className="notice">Notes are stored locally. They are not synced to a server or shared across devices.</p></section>
  : page==="Learning" ? <section className="stack">{heading("Learning Lab","Plan skills and training experiments for ATLAS.","PLANNING")}<div className="grid two">{card(<Sparkles/>,"Demonstration learning","Record human demonstrations and turn them into reviewed task examples.")}{card(<Activity/>,"Feedback & evaluation","Track outcomes in simulation and compare test runs.")}{card(<BrainCircuit/>,"Skill library","Store versioned, reviewed skills with clear permissions.")}{card(<ShieldCheck/>,"Safe testing","Require simulation, supervised trials and an emergency stop.","Required")}</div></section>
  : page==="Robotics" ? <section className="stack">{heading("Robotics Center","Hardware integration workspace.","NO ROBOT CONNECTED")}<div className="panel"><Bot size={44}/><h3>No robot connected</h3><p>ATLAS has no connection to motors, sensors or a robot controller.</p></div><div className="grid two">{card(<Radio/>,"Device connection","Future secure connection to supported robot controllers.","Not connected")}{card(<Activity/>,"Telemetry","Sensor readings and robot health when hardware is connected.","Unavailable")}</div><div className="safety"><ShieldCheck/><div><b>Physical controls are disabled</b><p>This prototype cannot move a robot. Future motion commands need an independent safety controller, limits and human confirmation.</p></div></div></section>
  : <section className="stack">{heading("Settings","Prototype configuration and system information.")}<div className="panel settings">{[["Application","ATLAS AI v1.0 prototype"],["Architecture","Hybrid cloud + edge (planned)"],["AI engine","Cloudflare Workers AI · GLM-4.7-Flash"],["Memory storage","This device / browser"],["Robot connection","Disabled"],["Safety mode","Physical actions disabled"]].map(([a,b])=><div className="setting" key={a}><span>{a}</span><b>{b}</b></div>)}</div><p className="notice">Never paste API keys or passwords into chat messages or public code. Store model-provider credentials only in private server-side environment variables.</p></section>;
  return <div className={page==="AI Assistant"?"app assistant-mode":"app"}><aside className={menu?"sidebar open":"sidebar"}><div className="brand"><AtlasLogo className="logo-brand"/><div><b>ATLAS<span>AI</span></b><small>PHYSICAL INTELLIGENCE</small></div><button className="x" onClick={()=>setMenu(false)}><X/></button></div><label>WORKSPACE</label><nav>{nav.map(([n,I])=><button className={page===n?"active":""} key={n} onClick={()=>{setPage(n);setMenu(false)}}><I size={18}/>{n}</button>)}</nav><div className="sidefoot"><b>● Cloud AI gateway</b><p>General chat uses the hosted GLM-4.7-Flash model. Local memory remains on this device.</p><small>ATLAS BUILD 0.5.0 · CLOUD MODEL</small></div></aside><main><header className="top"><button className="hamb" onClick={()=>setMenu(true)}><Menu/></button><span>ATLAS　›　<b>{page}</b></span><small>● Prototype</small></header><div className="content">{content}</div></main>{menu&&<button className="scrim" onClick={()=>setMenu(false)} aria-label="Close navigation"/>}</div>;
}
