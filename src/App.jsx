import React, { useEffect, useState } from "react";
import { runAtlasCore } from "./atlasCore.js";
import { Code2 } from "lucide-react";
import { getNeuralRuntimeStatus, checkAtlasBackend, generateAtlasResponse, generateAtlasCopilotResponse, generateProviderResponse } from "./modelRuntime.js";
import { Activity, Bot, BrainCircuit, Camera, Database, Eye, GraduationCap, Home, Menu, MessageSquare, Mic, Plus, Radio, Send, Settings, ShieldCheck, Sparkles, Trash2, Volume2, X } from "lucide-react";

function AtlasLogo({ className = "" }) {
  return <img className={className} src="/atlas-logo.svg" alt="ATLAS logo" />;
}

const initial = [
  { role: "atlas", text: "Welcome to ATLAS. I’m your general-purpose AI assistant, connected through the secured Cloudflare model gateway. I can help with research, engineering, software development, reasoning, and the specialist skill library. Ask a question to get started." },
  { role: "atlas", text: "Your conversation is routed through the configured hosted model. Relevant skill references are selected automatically when they match your request." }
];
const nav = [["Overview",Home],["AI Assistant",MessageSquare],["Copilot",Code2],["Vision Center",Eye],["Voice Center",Mic],["Memory",Database],["Learning",GraduationCap],["Robotics",Bot],["Settings",Settings]];

export default function App() {
  const [page,setPage] = useState("Overview");
  const [conversations,setConversations] = useState(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem("atlas-conversations"));
      if(Array.isArray(saved)&&saved.length)return saved;
      const legacy=JSON.parse(localStorage.getItem("atlas-messages"));
      return [{id:crypto.randomUUID(),title:"Welcome to ATLAS",messages:Array.isArray(legacy)&&legacy.length?legacy:initial,updatedAt:Date.now()}];
    } catch { return [{id:crypto.randomUUID(),title:"Welcome to ATLAS",messages:initial,updatedAt:Date.now()}]; }
  });
  const [activeConversationId,setActiveConversationId] = useState(()=>{
    try{return localStorage.getItem("atlas-active-conversation")||"";}catch{return "";}
  });
  const activeConversation=conversations.find(item=>item.id===activeConversationId)||conversations[0];
  const messages=activeConversation?.messages||initial;
  const copilotWelcome=[{role:"atlas",text:"ATLAS Copilot is ready for coding questions, complete implementations, debugging, and code reviews."}];
  const [copilotConversations,setCopilotConversations] = useState(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem("atlas-copilot-conversations"));
      if(Array.isArray(saved)&&saved.length)return saved;
      const legacy=JSON.parse(localStorage.getItem("atlas-copilot-messages"));
      return [{id:crypto.randomUUID(),title:"Welcome to Copilot",messages:Array.isArray(legacy)&&legacy.length?legacy:copilotWelcome,updatedAt:Date.now()}];
    } catch { return [{id:crypto.randomUUID(),title:"Welcome to Copilot",messages:copilotWelcome,updatedAt:Date.now()}]; }
  });
  const [activeCopilotConversationId,setActiveCopilotConversationId] = useState(()=>{
    try{return localStorage.getItem("atlas-active-copilot-conversation")||"";}catch{return "";}
  });
  const activeCopilotConversation=copilotConversations.find(item=>item.id===activeCopilotConversationId)||copilotConversations[0];
  const copilotMessages=activeCopilotConversation?.messages||copilotWelcome;
  const [memory,setMemory] = useState(()=>{try{return JSON.parse(localStorage.getItem("atlas-memory"))||["ATLAS is a general-purpose Physical AI project.","Architecture preference: hybrid cloud and local computing."]}catch{return []}});
  const [input,setInput] = useState("");
  const [provider,setProvider] = useState(()=>localStorage.getItem("atlas-provider")||"atlas");
  const [providerStates,setProviderStates] = useState({});
  useEffect(()=>{fetch("/api/providers").then(r=>r.ok?r.json():{}).then(data=>setProviderStates(data.providers||{})).catch(()=>setProviderStates({}));},[]);
  useEffect(()=>localStorage.setItem("atlas-provider",provider),[provider]);
  const [image,setImage] = useState("");
  const [menu,setMenu] = useState(false);
  const [notice,setNotice] = useState("");
  const [generating,setGenerating] = useState(false);
  const [gatewayReady,setGatewayReady] = useState(false);
  const [gatewayMessage,setGatewayMessage] = useState("Checking the hosted model gateway…");
  useEffect(()=>{const controller=new AbortController();checkAtlasBackend(controller.signal).then(status=>{const ready=status.status==="configured";setGatewayReady(ready);setGatewayMessage(ready?"Cloudflare Workers AI · Llama 3.3 primary with model fallbacks is connected.":"The hosted model is not configured.");}).catch(error=>{setGatewayReady(false);setGatewayMessage(error.message);});return()=>controller.abort();},[]);
  useEffect(()=>localStorage.setItem("atlas-conversations",JSON.stringify(conversations)),[conversations]);
  useEffect(()=>{if(activeConversation?.id){setActiveConversationId(activeConversation.id);localStorage.setItem("atlas-active-conversation",activeConversation.id);}},[activeConversation?.id]);
  useEffect(()=>localStorage.setItem("atlas-copilot-conversations",JSON.stringify(copilotConversations)),[copilotConversations]);
  useEffect(()=>{if(activeCopilotConversation?.id){setActiveCopilotConversationId(activeCopilotConversation.id);localStorage.setItem("atlas-active-copilot-conversation",activeCopilotConversation.id);}},[activeCopilotConversation?.id]);
  useEffect(()=>localStorage.setItem("atlas-memory",JSON.stringify(memory)),[memory]);
  function updateConversationMessages(id,updater){
    setConversations(items=>items.map(item=>{
      if(item.id!==id)return item;
      const next=typeof updater==="function"?updater(item.messages):updater;
      const firstUser=next.find(message=>message.role==="user");
      return {...item,messages:next,title:firstUser?(firstUser.text.slice(0,42)+(firstUser.text.length>42?"…":"")):item.title,updatedAt:Date.now()};
    }));
  }
  function newConversation(){
    const id=crypto.randomUUID();
    setConversations(items=>[{id,title:"New conversation",messages:initial,updatedAt:Date.now()},...items]);
    setActiveConversationId(id);
    localStorage.setItem("atlas-active-conversation",id);
    setInput("");
    setPage("AI Assistant");
  }
  function deleteConversation(id){
    const target=conversations.find(item=>item.id===id);
    if(!target)return;
    if(!window.confirm("Delete this conversation permanently from this device?"))return;
    const remaining=conversations.filter(item=>item.id!==id);
    if(remaining.length){
      setConversations(remaining);
      if(activeConversationId===id){setActiveConversationId(remaining[0].id);localStorage.setItem("atlas-active-conversation",remaining[0].id);}
    }else{
      const fresh={id:crypto.randomUUID(),title:"New conversation",messages:initial,updatedAt:Date.now()};
      setConversations([fresh]);setActiveConversationId(fresh.id);localStorage.setItem("atlas-active-conversation",fresh.id);
    }
  }
  function updateCopilotConversationMessages(id,updater){
    setCopilotConversations(items=>items.map(item=>{
      if(item.id!==id)return item;
      const next=typeof updater==="function"?updater(item.messages):updater;
      const firstUser=next.find(message=>message.role==="user");
      return {...item,messages:next,title:firstUser?(firstUser.text.slice(0,42)+(firstUser.text.length>42?"…":"")):item.title,updatedAt:Date.now()};
    }));
  }
  function newCopilotConversation(){
    const id=crypto.randomUUID();
    setCopilotConversations(items=>[{id,title:"New Copilot chat",messages:copilotWelcome,updatedAt:Date.now()},...items]);
    setActiveCopilotConversationId(id);
    localStorage.setItem("atlas-active-copilot-conversation",id);
    setInput("");
    setPage("Copilot");
  }
  function deleteCopilotConversation(id){
    if(!copilotConversations.some(item=>item.id===id))return;
    if(!window.confirm("Delete this Copilot conversation permanently from this device?"))return;
    const remaining=copilotConversations.filter(item=>item.id!==id);
    if(remaining.length){
      setCopilotConversations(remaining);
      if(activeCopilotConversationId===id){setActiveCopilotConversationId(remaining[0].id);localStorage.setItem("atlas-active-copilot-conversation",remaining[0].id);}
    }else{
      const fresh={id:crypto.randomUUID(),title:"New Copilot chat",messages:copilotWelcome,updatedAt:Date.now()};
      setCopilotConversations([fresh]);setActiveCopilotConversationId(fresh.id);localStorage.setItem("atlas-active-copilot-conversation",fresh.id);
    }
  }
  async function send(e){
    e.preventDefault();
    const value=input.trim();
    if(!value||generating)return;
    const isCopilot=page==="Copilot";
    const conversationId=activeConversation?.id;
    const copilotConversationId=activeCopilotConversation?.id;
    const activeMessages=isCopilot?copilotMessages:messages;
    const userMessage={role:"user",text:value};
    const nextMessages=[...activeMessages,userMessage];
    if(isCopilot)updateCopilotConversationMessages(copilotConversationId,nextMessages);else updateConversationMessages(conversationId,nextMessages);
    setInput("");
    const localCommand=!isCopilot && /^(remember that|remember|save this|store this|what do you remember|show memory|list memories|my memories|find |search memory for |do you remember |help$|roadmap$|development plan$)/i.test(value);
    if(localCommand){
      const result=runAtlasCore(value,memory,messages);
      if(result.action==="save_memory"&&result.memory){
        setMemory(items=>items.includes(result.memory)?items:[...items,result.memory]);
      }
      updateConversationMessages(conversationId,items=>[...items,{role:"atlas",text:result.text}]);
      return;
    }
    setGenerating(true);
    try{
      const reply=isCopilot ? await generateAtlasCopilotResponse(nextMessages) : await generateProviderResponse(provider,nextMessages);
      if(isCopilot)updateCopilotConversationMessages(copilotConversationId,items=>[...items,{role:"atlas",text:reply}]);
      else updateConversationMessages(conversationId,items=>[...items,{role:"atlas",text:reply}]);
    }catch(error){
      const failure={role:"atlas",text:`I couldn't reach the ATLAS language-model service. ${error.message} Your message remains in this chat. Please retry when the gateway is available.`};
      if(isCopilot)updateCopilotConversationMessages(copilotConversationId,items=>[...items,failure]);
      else updateConversationMessages(conversationId,items=>[...items,failure]);
    }finally{
      setGenerating(false);
    }
  }
  function addMemory(){const v=prompt("What should ATLAS save in project memory?");if(v?.trim())setMemory(m=>[...m,v.trim()])}
  function heading(title,sub,badge){return <header className="pagehead"><div className="headicon"><AtlasLogo className="logo-head"/></div><div><div className="headrow"><h1>{title}</h1>{badge&&<span className="badge">{badge}</span>}</div><p>{sub}</p></div></header>}
  function card(icon,title,desc,status="Planned"){return <article className="card"><div className="cardtop"><span className="cardicon">{icon}</span><span className="badge">{status}</span></div><h3>{title}</h3><p>{desc}</p></article>}
  const neuralStatus = {...getNeuralRuntimeStatus(),available:gatewayReady,reason:gatewayMessage};
  const content = page==="Overview" ? <section className="stack">
    <div className="hero"><div className="eyebrow"><AtlasLogo className="hero-logo"/> PROJECT WORKSPACE · V1.1</div><h1>Build intelligence<br/><em>that can act in the real world.</em></h1><p>ATLAS is a modular foundation for conversational AI, perception, learning and safe robotics integration.</p><button onClick={()=>setPage("AI Assistant")}> <MessageSquare size={16}/> Open AI assistant</button></div>
    <h2>SYSTEM OVERVIEW</h2><div className="grid four">{card(<BrainCircuit/>,"AI Core","Local intent engine connected","Local v0.2")}{card(<Sparkles/>,"Neural Runtime",neuralStatus.reason,neuralStatus.available?"Ready":"Not installed")}{card(<Database/>,"Project Memory",memory.length+" notes on this device","Local")}{card(<Eye/>,"Vision","Image preview only","Standby")}{card(<Bot/>,"Robotics","No hardware connected","Offline")}</div>
    <h2>DEVELOPMENT MODULES</h2><div className="grid two">{card(<MessageSquare/>,"Conversational intelligence","Hosted Llama 3.3 primary model with Gemma 4 and GLM fallbacks through Cloudflare Workers AI.","Interface ready")}{card(<Eye/>,"Perception & vision","Prepare image inputs for future computer vision.","Preview ready")}{card(<GraduationCap/>,"Learning system","Plan supervised demonstrations and evaluation.","Planned")}{card(<Bot/>,"Robotics integration","A safe bridge to controllers after simulation and testing.","Not connected")}</div>
    <div className="safety"><ShieldCheck/><div><b>Safety-first development</b><p>This is a software prototype. It does not control physical devices. Real robot movement must use independent safety limits and supervised testing.</p></div></div>
  </section> : page==="AI Assistant" ? <section className="stack grok-page"><div className="grok-workspace"><aside className="grok-history"><button className="grok-new-chat" onClick={newConversation}><Plus size={17}/> <span>New chat</span></button><div className="grok-history-label">YOUR CHATS</div><div className="grok-history-list" aria-label="ATLAS conversation history">{conversations.map(item=><div className={item.id===activeConversation?.id?"grok-history-item active":"grok-history-item"} key={item.id}><button className="grok-history-open" onClick={()=>{setActiveConversationId(item.id);setInput("");}} title={item.title}>{item.title}</button><button className="grok-history-delete" onClick={()=>deleteConversation(item.id)} aria-label={"Delete "+item.title} title="Delete conversation"><Trash2 size={14}/></button></div>)}</div><div className="grok-history-foot"><span className="grok-status-dot"/> ATLAS · PRIVATE SESSION</div></aside><div className="grok-chat-main"><div className="grok-topbar"><div className="grok-title"><span className="grok-mark"><AtlasLogo/></span><div><b>ATLAS</b><small>GENERAL INTELLIGENCE</small></div></div><div className="grok-top-actions"><span className="grok-model-tag">AUTO MODEL</span><span className="grok-online"><i/> {gatewayReady?"ONLINE":"CONNECTING"}</span></div></div><div className="grok-messages">{messages.map((m,i)=><div className={"grok-message "+m.role} key={i}>{m.role==="atlas"&&<span className="grok-message-avatar"><AtlasLogo/></span>}<div className="grok-message-body">{m.role==="user"&&<b>YOU</b>}<p>{m.text}</p></div></div>)}</div><div className="grok-compose-area"><div className="grok-model-row"><label htmlFor="atlas-provider">MODEL</label><select id="atlas-provider" value={provider} onChange={e=>setProvider(e.target.value)}><option value="atlas">ATLAS · Auto</option><option value="nvidia" disabled={!providerStates.nvidia?.configured}>NVIDIA API Catalog{providerStates.nvidia?.configured?"":" · unavailable"}</option></select></div><form className="grok-composer" onSubmit={send}><textarea aria-label="Message ATLAS" rows="1" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form.requestSubmit();}}} placeholder="Ask ATLAS anything…"/><div className="grok-composer-bottom"><span>Enter to send · Shift + Enter for a new line</span><button aria-label="Send message" disabled={!input.trim()||generating}><Send size={17}/></button></div></form><small>{generating?"ATLAS is thinking…":"AI can make mistakes. Verify important information."}</small></div></div></div></section>
  : page==="Copilot" ? <section className="stack grok-page"><div className="grok-workspace"><aside className="grok-history"><button className="grok-new-chat" onClick={newCopilotConversation}><Plus size={17}/> <span>New chat</span></button><div className="grok-history-label">COPILOT CHATS</div><div className="grok-history-list" aria-label="Copilot conversation history">{copilotConversations.map(item=><div className={item.id===activeCopilotConversation?.id?"grok-history-item active":"grok-history-item"} key={item.id}><button className="grok-history-open" onClick={()=>{setActiveCopilotConversationId(item.id);localStorage.setItem("atlas-active-copilot-conversation",item.id);setInput("");}} title={item.title}>{item.title}</button><button className="grok-history-delete" onClick={()=>deleteCopilotConversation(item.id)} aria-label={"Delete "+item.title} title="Delete Copilot conversation"><Trash2 size={14}/></button></div>)}</div><div className="grok-history-foot"><span className="grok-status-dot"/> ATLAS COPILOT · PRIVATE SESSION</div></aside><div className="grok-chat-main"><div className="grok-topbar"><div className="grok-title"><span className="grok-mark"><AtlasLogo/></span><div><b>ATLAS Copilot</b><small>SOFTWARE ENGINEERING</small></div></div><div className="grok-top-actions"><span className="grok-model-tag">CODING MODE</span><span className="grok-online"><i/> {gatewayReady?"ONLINE":"CONNECTING"}</span></div></div><div className="grok-messages">{copilotMessages.map((m,i)=><div className={"grok-message "+m.role} key={i}>{m.role==="atlas"&&<span className="grok-message-avatar"><AtlasLogo/></span>}<div className="grok-message-body">{m.role==="user"&&<b>YOU</b>}<p>{m.text}</p></div></div>)}</div><div className="grok-compose-area"><div className="grok-composer-hint">Ask Copilot to write, explain, debug, or review code.</div><form className="grok-composer" onSubmit={send}><textarea aria-label="Message ATLAS Copilot" rows="1" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form.requestSubmit();}}} placeholder="Ask ATLAS Copilot about your code…"/><div className="grok-composer-bottom"><span>Enter to send · Shift + Enter for a new line</span><button aria-label="Send message" disabled={!input.trim()||generating}><Send size={17}/></button></div></form><small>{generating?"Copilot is thinking…":"AI can make mistakes. Review generated code before using it."}</small></div></div></div></section>
  : page==="Vision Center" ? <section className="stack">{heading(page,"Prepare image input for future computer-vision features.","NOT CONNECTED")}<div className="panel"><Camera size={30}/><h3>Image input</h3><p>Choose a picture from your phone to preview it here. This prototype does not send images to an AI model.</p><label className="button">Choose image<input hidden type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f){setImage(URL.createObjectURL(f));setNotice("Local preview only. AI analysis is not connected.")}}}/></label>{image&&<img className="preview" src={image} alt="Selected preview"/>}{notice&&<p className="notice">{notice}</p>}</div>{card(<ShieldCheck/>,"Planned vision capabilities","Object recognition, camera integration, visual Q&A and privacy controls.")}</section>
  : page==="Voice Center" ? <section className="stack">{heading(page,"Voice interaction will be added after the AI backend.","COMING NEXT")}<div className="panel"><Mic size={36}/><h3>Voice interface</h3><p>Microphone capture and spoken responses are not connected yet. Permissions will be requested only when implemented.</p><button onClick={()=>setNotice("Voice features are planned for a later milestone.")}><Volume2 size={16}/> Check status</button>{notice&&<p className="notice">{notice}</p>}</div></section>
  : page==="Memory" ? <section className="stack">{heading("Project Memory","Notes are stored in this browser on this device.")}<div className="toolbar"><span>{memory.length} saved notes</span><button onClick={addMemory}>+ Add memory</button></div>{memory.map((m,i)=><div className="memory" key={i}><Database/><p>{m}</p><button className="delete" onClick={()=>setMemory(a=>a.filter((_,n)=>n!==i))}>Delete</button></div>)}<p className="notice">Notes are stored locally. They are not synced to a server or shared across devices.</p></section>
  : page==="Learning" ? <section className="stack">{heading("Learning Lab","Plan skills and training experiments for ATLAS.","PLANNING")}<div className="grid two">{card(<Sparkles/>,"Demonstration learning","Record human demonstrations and turn them into reviewed task examples.")}{card(<Activity/>,"Feedback & evaluation","Track outcomes in simulation and compare test runs.")}{card(<BrainCircuit/>,"Skill library","Store versioned, reviewed skills with clear permissions.")}{card(<ShieldCheck/>,"Safe testing","Require simulation, supervised trials and an emergency stop.","Required")}</div></section>
  : page==="Robotics" ? <section className="stack robotics-page">{heading("Robotics Center","Universal hardware integration · vendor-neutral adapter architecture.","BRIDGE OFFLINE")}<div className="robotics-status"><div className="robotics-status-icon"><Bot size={27}/></div><div><b>Local Robotics Bridge not connected</b><p>ATLAS cloud chat cannot access USB, serial, CAN, GPIO or devices on your phone directly. A separately installed local bridge will be required on a supported robot computer.</p></div><span className="badge">OFFLINE</span></div><div className="robotics-section-head"><div><h2>UNIVERSAL CONNECTION PLUGINS</h2><p>Adapters are designed to be added independently; no manufacturer lock-in.</p></div></div><div className="grid two robotics-adapters">{[["ROS 2 / DDS","ROS 2 nodes, topics and service discovery","Planned"],["micro-ROS","Microcontroller telemetry through a ROS 2 agent","Planned"],["Serial / USB","Generic USB serial controller bridges","Planned"],["CAN bus","Vehicle and industrial controller telemetry adapters","Planned"],["Ethernet / TCP","LAN-connected robot controller adapters","Planned"],["Vendor SDK adapters","Manufacturer-specific drivers behind a common interface","Planned"],["Camera / depth","USB, Ethernet and supported edge-camera metadata","Planned"],["Sensors / telemetry","IMU, encoders, range, force and health telemetry","Planned"]].map(([name,desc,status])=><article className="card robotics-adapter" key={name}><div className="cardtop"><span className="cardicon"><Radio size={18}/></span><span className="badge">{status}</span></div><h3>{name}</h3><p>{desc}</p></article>)}</div><div className="robotics-section-head"><div><h2>INTEGRATION LAYERS</h2><p>Discovery and telemetry first; actuation remains locked out.</p></div></div><div className="grid two">{card(<Activity/>,"Device discovery","Future bridge will report approved adapter IDs, device identity and connection health. No scan is running now.","Not connected")}{card(<Database/>,"Sensor telemetry","Read-only, timestamped and unit-labelled sensor data with stale-data detection.","Not connected")}{card(<ShieldCheck/>,"Safety supervisor","Independent hardware emergency stop, watchdog, interlocks and operator authorization.","Required")}{card(<BrainCircuit/>,"Simulation first","Validate adapter contracts and sensor streams against mock devices before hardware trials.","Planned")}</div><div className="safety"><ShieldCheck/><div><b>Physical motion is disabled by design</b><p>This first integration phase provides architecture and status only. No motor, actuator, servo, gripper or movement command is sent. Future motion support must be separately reviewed, explicitly authorized and protected by independent hardware safety controls.</p></div></div><p className="notice">Plugin architecture specification: <code>docs/ROBOTICS_PLUGIN_ARCHITECTURE.md</code>. No robot is currently paired and no local bridge is installed or running.</p></section>
  : <section className="stack">{heading("Settings","Prototype configuration and system information.")}<div className="panel settings">{[["Application","ATLAS AI v1.0 prototype"],["Architecture","Hybrid cloud + edge (planned)"],["AI engine","Cloudflare Workers AI · Llama 3.3 + fallbacks"],["Memory storage","This device / browser"],["Robot connection","Disabled"],["Safety mode","Physical actions disabled"]].map(([a,b])=><div className="setting" key={a}><span>{a}</span><b>{b}</b></div>)}</div><p className="notice">Never paste API keys or passwords into chat messages or public code. Store model-provider credentials only in private server-side environment variables.</p></section>;
  return <div className="app"><aside className={menu?"sidebar open":"sidebar"}><div className="brand"><AtlasLogo className="logo-brand"/><div><b>ATLAS<span>AI</span></b><small>PHYSICAL INTELLIGENCE</small></div><button className="x" onClick={()=>setMenu(false)}><X/></button></div><label>WORKSPACE</label><nav>{nav.map(([n,I])=><button className={page===n?"active":""} key={n} onClick={()=>{setPage(n);setMenu(false)}}><I size={18}/>{n}</button>)}</nav><div className="sidefoot"><b>● Cloud AI gateway</b><p>General chat uses the hosted Llama 3.3 primary model and fallbacks. Local memory remains on this device.</p><small>ATLAS BUILD 0.5.0 · CLOUD MODEL</small></div></aside><main><header className="top"><button className="hamb" onClick={()=>setMenu(true)}><Menu/></button><span>ATLAS　›　<b>{page}</b></span><small>● Prototype</small></header><div className="content">{content}</div></main>{menu&&<button className="scrim" onClick={()=>setMenu(false)} aria-label="Close navigation"/>}</div>;
}
