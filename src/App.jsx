import React, { useEffect, useRef, useState } from "react";
import { runAtlasCore } from "./atlasCore.js";
import { getBluetoothDiscoveryStatus, discoverBluetoothDevice, scanNativeBluetoothDevices } from "./roboticsDiscovery.js";
import { Capacitor } from "@capacitor/core";
import { getRoboticsTransportCatalog } from "./roboticsTransports.js";
import { createSpeechRecognition, getVoiceCapabilities, speakText, stopSpeechPlayback } from "./voiceInterface.js";
import { Code2 } from "lucide-react";
import { getNeuralRuntimeStatus, checkAtlasBackend, generateAtlasResponse, generateAtlasCopilotResponse, generateProviderResponse } from "./modelRuntime.js";
import { Activity, Bot, BrainCircuit, Camera, Check, Database, Eye, GraduationCap, Home, Menu, MessageSquare, Mic, MicOff, Plus, Radio, Send, Settings, ShieldCheck, Sparkles, Trash2, Volume2, X } from "lucide-react";

function AtlasLogo({ className = "" }) {
  return <img className={className} src="/atlas-logo.svg" alt="ATLAS logo" />;
}

const initial = [
  { role: "atlas", text: "Welcome to ATLAS. I’m your general-purpose AI assistant, connected through the secured Cloudflare model gateway. I can help with research, engineering, software development, reasoning, and the specialist skill library. Ask a question to get started." },
  { role: "atlas", text: "Your conversation is routed through the configured hosted model. Relevant skill references are selected automatically when they match your request." }
];
const nav = [["Overview",Home],["AI Assistant",MessageSquare],["Copilot",Code2],["Vision Center",Eye],["Voice Center",Volume2],["Memory",Database],["Learning",GraduationCap],["Robotics",Bot],["Settings",Settings]];

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
  const conversationsRef = useRef(conversations);
  const sendInProgressRef = useRef(false);
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
  const copilotConversationsRef = useRef(copilotConversations);
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
  const [voiceStatus,setVoiceStatus] = useState("Ready. Type a message and ATLAS will speak its reply.");
  const [isListening,setIsListening] = useState(false);
  const [voiceInputAvailable] = useState(()=>getVoiceCapabilities().speechRecognition);
  const voiceRecognitionRef = useRef(null);
  const voiceTranscriptRef = useRef("");
  const voiceCancelledRef = useRef(false);
  const voiceErrorRef = useRef("");
  const [robotSimRunning,setRobotSimRunning] = useState(false);
  const [robotSimPosition,setRobotSimPosition] = useState(0);
  const [robotSimSpeed,setRobotSimSpeed] = useState(35);
  const [robotSimDirection,setRobotSimDirection] = useState(1);
  const [robotDiscoveryCapability] = useState(()=>getBluetoothDiscoveryStatus({...globalThis,Capacitor}));
  const [robotDiscoveryBusy,setRobotDiscoveryBusy] = useState(false);
  const [robotDiscoveryMessage,setRobotDiscoveryMessage] = useState("Ready to check nearby Bluetooth devices.");
  const [robotBluetoothDevice,setRobotBluetoothDevice] = useState(null);
  const [robotDiscoveredDevices,setRobotDiscoveredDevices] = useState([]);
  useEffect(()=>{
    if(!robotSimRunning)return;
    const timer=setInterval(()=>setRobotSimPosition(position=>{
      const next=position+robotSimDirection*robotSimSpeed/100;
      if(next>=100){setRobotSimDirection(-1);return 100;}
      if(next<=0){setRobotSimDirection(1);return 0;}
      return next;
    }),100);
    return ()=>clearInterval(timer);
  },[robotSimRunning,robotSimSpeed,robotSimDirection]);
  const [gatewayReady,setGatewayReady] = useState(false);
  const [gatewayMessage,setGatewayMessage] = useState("Checking the hosted model gateway…");
  useEffect(()=>{const controller=new AbortController();checkAtlasBackend(controller.signal).then(status=>{const ready=status.status==="configured";setGatewayReady(ready);setGatewayMessage(ready?"Cloudflare Workers AI · Llama 3.3 primary with model fallbacks is connected.":"The hosted model is not configured.");}).catch(error=>{setGatewayReady(false);setGatewayMessage(error.message);});return()=>controller.abort();},[]);
  function commitConversations(updater){
    const current=conversationsRef.current;
    const next=typeof updater==="function"?updater(current):updater;
    conversationsRef.current=next;
    setConversations(next);
    try{localStorage.setItem("atlas-conversations",JSON.stringify(next));}
    catch(error){console.warn("ATLAS could not persist chat history locally.",error);}
  }
  function commitCopilotConversations(updater){
    const current=copilotConversationsRef.current;
    const next=typeof updater==="function"?updater(current):updater;
    copilotConversationsRef.current=next;
    setCopilotConversations(next);
    try{localStorage.setItem("atlas-copilot-conversations",JSON.stringify(next));}
    catch(error){console.warn("ATLAS could not persist Copilot history locally.",error);}
  }
  useEffect(()=>{try{localStorage.setItem("atlas-conversations",JSON.stringify(conversations));}catch(error){console.warn("ATLAS chat history persistence failed.",error);}},[conversations]);
  useEffect(()=>{if(activeConversation?.id){setActiveConversationId(activeConversation.id);localStorage.setItem("atlas-active-conversation",activeConversation.id);}},[activeConversation?.id]);
  useEffect(()=>{try{localStorage.setItem("atlas-copilot-conversations",JSON.stringify(copilotConversations));}catch(error){console.warn("ATLAS Copilot history persistence failed.",error);}},[copilotConversations]);
  useEffect(()=>{if(activeCopilotConversation?.id){setActiveCopilotConversationId(activeCopilotConversation.id);localStorage.setItem("atlas-active-copilot-conversation",activeCopilotConversation.id);}},[activeCopilotConversation?.id]);
  useEffect(()=>localStorage.setItem("atlas-memory",JSON.stringify(memory)),[memory]);
  function updateConversationMessages(id,updater){
    commitConversations(items=>items.map(item=>{
      if(item.id!==id)return item;
      const next=typeof updater==="function"?updater(item.messages):updater;
      const firstUser=next.find(message=>message.role==="user");
      return {...item,messages:next,title:firstUser?(firstUser.text.slice(0,42)+(firstUser.text.length>42?"…":"")):item.title,updatedAt:Date.now()};
    }));
  }
  function newConversation(){
    const id=crypto.randomUUID();
    commitConversations(items=>[{id,title:"New conversation",messages:initial,updatedAt:Date.now()},...items]);
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
      commitConversations(remaining);
      if(activeConversationId===id){setActiveConversationId(remaining[0].id);localStorage.setItem("atlas-active-conversation",remaining[0].id);}
    }else{
      const fresh={id:crypto.randomUUID(),title:"New conversation",messages:initial,updatedAt:Date.now()};
      commitConversations([fresh]);setActiveConversationId(fresh.id);localStorage.setItem("atlas-active-conversation",fresh.id);
    }
  }
  function updateCopilotConversationMessages(id,updater){
    commitCopilotConversations(items=>items.map(item=>{
      if(item.id!==id)return item;
      const next=typeof updater==="function"?updater(item.messages):updater;
      const firstUser=next.find(message=>message.role==="user");
      return {...item,messages:next,title:firstUser?(firstUser.text.slice(0,42)+(firstUser.text.length>42?"…":"")):item.title,updatedAt:Date.now()};
    }));
  }
  function newCopilotConversation(){
    const id=crypto.randomUUID();
    commitCopilotConversations(items=>[{id,title:"New Copilot chat",messages:copilotWelcome,updatedAt:Date.now()},...items]);
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
      commitCopilotConversations(remaining);
      if(activeCopilotConversationId===id){setActiveCopilotConversationId(remaining[0].id);localStorage.setItem("atlas-active-copilot-conversation",remaining[0].id);}
    }else{
      const fresh={id:crypto.randomUUID(),title:"New Copilot chat",messages:copilotWelcome,updatedAt:Date.now()};
      commitCopilotConversations([fresh]);setActiveCopilotConversationId(fresh.id);localStorage.setItem("atlas-active-copilot-conversation",fresh.id);
    }
  }
  function cancelVoiceInput(){
    const recognition=voiceRecognitionRef.current;
    if(!recognition)return;
    voiceCancelledRef.current=true;
    voiceTranscriptRef.current="";
    voiceRecognitionRef.current=null;
    setIsListening(false);
    try{recognition.abort();}catch{}
    setInput("");
    setVoiceStatus("Voice input cancelled. ATLAS is not listening.");
  }
  function stopVoiceInput(){
    const recognition=voiceRecognitionRef.current;
    if(!recognition)return;
    setVoiceStatus("Finishing your voice message…");
    try{recognition.stop();}catch(error){
      setIsListening(false);
      setVoiceStatus("Could not stop voice input: "+(error?.message||"please try again"));
    }
  }
  function startVoiceInput(){
    if(isListening||generating)return;
    if(!voiceInputAvailable){
      setVoiceStatus("Voice input is not supported in this browser. Try the ATLAS website in a supported browser, or type your message.");
      return;
    }
    stopSpeechPlayback();
    voiceTranscriptRef.current="";
    voiceCancelledRef.current=false;
    voiceErrorRef.current="";
    setInput("");
    setVoiceStatus("Requesting microphone access…");
    try{
      const recognition=createSpeechRecognition(globalThis,{
        onStart:()=>{setIsListening(true);setVoiceStatus("Listening for this turn only. Speak, then pause; ATLAS will reply aloud.");},
        onResult:event=>{
          let finalText="";
          let interimText="";
          for(let index=event.resultIndex||0;index<event.results.length;index++){
            const result=event.results[index];
            const transcript=result?.[0]?.transcript||"";
            if(result?.isFinal)finalText+=transcript+" ";
            else interimText+=transcript;
          }
          if(finalText)voiceTranscriptRef.current=(voiceTranscriptRef.current+" "+finalText).trim();
          setInput((voiceTranscriptRef.current+" "+interimText).trim());
        },
        onError:event=>{
          if(event?.error==="aborted")return;
          voiceErrorRef.current=event?.error||"unknown";
          setVoiceStatus(event?.error==="not-allowed"||event?.error==="service-not-allowed"
            ?"Microphone permission was not granted. ATLAS has stopped listening."
            :"Voice input error: "+voiceErrorRef.current+". You can try again or type your message.");
        },
        onEnd:()=>{
          setIsListening(false);
          if(voiceRecognitionRef.current!==recognition)return;
          voiceRecognitionRef.current=null;
          if(voiceCancelledRef.current)return;
          const spoken=voiceTranscriptRef.current.trim();
          voiceTranscriptRef.current="";
          if(spoken){
            setInput("");
            setVoiceStatus("You said: "+spoken+" — ATLAS is preparing a reply…");
            void sendMessage(spoken,{speak:true,voiceModeActive:true});
          }else if(!voiceErrorRef.current){
            setVoiceStatus("No speech detected. ATLAS is not listening. Tap the microphone when you are ready.");
          }
        }
      });
      voiceRecognitionRef.current=recognition;
      recognition.start();
      setIsListening(true);
    }catch(error){
      voiceRecognitionRef.current=null;
      setIsListening(false);
      setVoiceStatus("Could not start voice input: "+(error?.message||"microphone unavailable"));
    }
  }
  async function speakVoiceReply(text){
    setVoiceStatus("ATLAS is speaking…");
    try{
      await speakText(text);
      setVoiceStatus("Ready. Type another message whenever you like.");
    }catch(error){
      if(error?.message==="Speech playback interrupted.") {
        setVoiceStatus("Speech stopped.");
      } else {
        setVoiceStatus("Spoken reply unavailable: "+(error?.message||"audio playback failed"));
      }
    }
  }
  async function sendMessage(value,{isCopilot=false,speak=false,voiceModeActive=false}={}){
    const messageText=String(value||"").trim();
    // React state updates are asynchronous; use a synchronous lock to prevent
    // rapid taps/duplicate form submissions from racing and replacing a chat.
    if(!messageText||sendInProgressRef.current)return;
    sendInProgressRef.current=true;
    const conversationId=activeConversation?.id;
    const copilotConversationId=activeCopilotConversation?.id;
    const currentItems=isCopilot?copilotConversationsRef.current:conversationsRef.current;
    const activeId=isCopilot?copilotConversationId:conversationId;
    const activeEntry=currentItems.find(item=>item.id===activeId)||currentItems[0];
    const activeMessages=activeEntry?.messages||(isCopilot?copilotWelcome:initial);
    const targetId=activeEntry?.id;
    const userMessage={role:"user",text:messageText};
    const nextMessages=[...activeMessages,userMessage];
    if(isCopilot)updateCopilotConversationMessages(targetId,items=>[...items,userMessage]);else updateConversationMessages(targetId,items=>[...items,userMessage]);
    if(!isCopilot)setInput("");
    const localCommand=!isCopilot && /^(remember that|remember|save this|store this|what do you remember|show memory|list memories|my memories|find |search memory for |do you remember |help$|roadmap$|development plan$)/i.test(messageText);
    if(localCommand){
      const result=runAtlasCore(messageText,memory,activeMessages);
      if(result.action==="save_memory"&&result.memory)setMemory(items=>items.includes(result.memory)?items:[...items,result.memory]);
      updateConversationMessages(targetId,items=>[...items,{role:"atlas",text:result.text}]);
      sendInProgressRef.current=false;
      if(speak)await speakVoiceReply("Certainly, sir. "+result.text);
      return;
    }
    setGenerating(true);
    try{
      const reply=isCopilot ? await generateAtlasCopilotResponse(nextMessages) : await generateProviderResponse(provider,nextMessages,undefined,{voiceMode:voiceModeActive});
      if(isCopilot)updateCopilotConversationMessages(targetId,items=>[...items,{role:"atlas",text:reply}]);
      else updateConversationMessages(targetId,items=>[...items,{role:"atlas",text:reply}]);
      // Release the generation guard before speaking, allowing a recognised
      // interruption to submit a fresh instruction while playback is active.
      setGenerating(false);
      sendInProgressRef.current=false;
      if(speak)await speakVoiceReply(reply);
    }catch(error){
      const failure={role:"atlas",text:`I couldn't reach the ATLAS language-model service. ${error.message} Your message remains in this chat. Please retry when the gateway is available.`};
      if(isCopilot)updateCopilotConversationMessages(targetId,items=>[...items,failure]);
      else updateConversationMessages(targetId,items=>[...items,failure]);
      setGenerating(false);
      sendInProgressRef.current=false;
      if(speak)await speakVoiceReply(failure.text);
    }finally{
      setGenerating(false);
      sendInProgressRef.current=false;
    }
  }
  async function send(e){
    e.preventDefault();
    return sendMessage(input,{isCopilot:page==="Copilot",speak:page==="Voice Center"});
  }
  useEffect(()=>()=>{try{voiceRecognitionRef.current?.abort();}catch{} voiceRecognitionRef.current=null; stopSpeechPlayback();},[]);
  async function startRobotDiscovery(){
    if(robotDiscoveryBusy)return;
    setRobotDiscoveryBusy(true);
    setRobotDiscoveredDevices([]);
    setRobotDiscoveryMessage('Preparing Bluetooth discovery…');
    try{
      if(Capacitor.isNativePlatform()){
        setRobotDiscoveryMessage('Requesting Android Bluetooth permission and scanning for 12 seconds…');
        const result=await scanNativeBluetoothDevices({
          environment:{...globalThis,Capacitor},
          durationMs:12000,
          onDevice:device=>setRobotDiscoveredDevices(items=>items.some(item=>item.id===device.id)?items:[...items,device])
        });
        setRobotDiscoveryMessage(result.found?'Scan finished. '+result.found+' Bluetooth device(s) discovered. No control commands were sent.':'Scan finished. No advertising Bluetooth LE devices were found nearby.');
      }else{
        setRobotDiscoveryMessage('Opening the system Bluetooth device picker…');
        const result=await discoverBluetoothDevice();
        setRobotBluetoothDevice(result);
        setRobotDiscoveredDevices([result]);
        setRobotDiscoveryMessage(result.connected?'Connected to '+result.name+'. Read-only discovery only.':'Selected '+result.name+'; GATT connection is not active.');
        result.device?.addEventListener?.('gattserverdisconnected',()=>{
          setRobotBluetoothDevice(current=>current?.id===result.id?{...current,connected:false,connection:'disconnected'}:current);
          setRobotDiscoveryMessage(result.name+' disconnected.');
        });
      }
    }catch(error){
      setRobotDiscoveryMessage(error?.name==='NotFoundError'?'No device selected. Discovery can be started again.':error.message||'Bluetooth discovery failed.');
    }finally{setRobotDiscoveryBusy(false);}
  }
  function disconnectRobotDevice(){
    try{if(robotBluetoothDevice?.device?.gatt?.connected)robotBluetoothDevice.device.gatt.disconnect();}catch{}
    setRobotBluetoothDevice(null);
    setRobotDiscoveryMessage("Device disconnected. Ready for another discovery session.");
  }
  function addMemory(){const v=prompt("What should ATLAS save in project memory?");if(v?.trim())setMemory(m=>[...m,v.trim()])}
  function heading(title,sub,badge){return <header className="pagehead"><div className="headicon"><AtlasLogo className="logo-head"/></div><div><div className="headrow"><h1>{title}</h1>{badge&&<span className="badge">{badge}</span>}</div><p>{sub}</p></div></header>}
  function card(icon,title,desc,status="Planned"){return <article className="card"><div className="cardtop"><span className="cardicon">{icon}</span><span className="badge">{status}</span></div><h3>{title}</h3><p>{desc}</p></article>}
  const neuralStatus = {...getNeuralRuntimeStatus(),available:gatewayReady,reason:gatewayMessage};
  const roboticsTransportCatalog = getRoboticsTransportCatalog({nativeAndroid:Capacitor.isNativePlatform()});
  const content = page==="Overview" ? <section className="stack">
    <div className="hero"><div className="eyebrow"><AtlasLogo className="hero-logo"/> PROJECT WORKSPACE · V1.1</div><h1>Build intelligence<br/><em>that can act in the real world.</em></h1><p>ATLAS is a modular foundation for conversational AI, perception, learning and safe robotics integration.</p><button onClick={()=>setPage("AI Assistant")}> <MessageSquare size={16}/> Open AI assistant</button></div>
    <h2>SYSTEM OVERVIEW</h2><div className="grid four">{card(<BrainCircuit/>,"AI Core","Local intent engine connected","Local v0.2")}{card(<Sparkles/>,"Neural Runtime",neuralStatus.reason,neuralStatus.available?"Ready":"Not installed")}{card(<Database/>,"Project Memory",memory.length+" notes on this device","Local")}{card(<Eye/>,"Vision","Image preview only","Standby")}{card(<Bot/>,"Robotics","No hardware connected","Offline")}</div>
    <h2>DEVELOPMENT MODULES</h2><div className="grid two">{card(<MessageSquare/>,"Conversational intelligence","Hosted Llama 3.3 primary model with Gemma 4 and GLM fallbacks through Cloudflare Workers AI.","Interface ready")}{card(<Eye/>,"Perception & vision","Prepare image inputs for future computer vision.","Preview ready")}{card(<GraduationCap/>,"Learning system","Plan supervised demonstrations and evaluation.","Planned")}{card(<Bot/>,"Robotics integration","A safe bridge to controllers after simulation and testing.","Not connected")}</div>
    <div className="safety"><ShieldCheck/><div><b>Safety-first development</b><p>This is a software prototype. It does not control physical devices. Real robot movement must use independent safety limits and supervised testing.</p></div></div>
  </section> : page==="AI Assistant" ? <section className="stack grok-page"><div className="grok-workspace"><aside className="grok-history"><button className="grok-new-chat" onClick={newConversation}><Plus size={17}/> <span>New chat</span></button><div className="grok-history-label">YOUR CHATS</div><div className="grok-history-list" aria-label="ATLAS conversation history">{conversations.map(item=><div className={item.id===activeConversation?.id?"grok-history-item active":"grok-history-item"} key={item.id}><button className="grok-history-open" onClick={()=>{setActiveConversationId(item.id);setInput("");}} title={item.title}>{item.title}</button><button className="grok-history-delete" onClick={()=>deleteConversation(item.id)} aria-label={"Delete "+item.title} title="Delete conversation"><Trash2 size={14}/></button></div>)}</div><div className="grok-history-foot"><span className="grok-status-dot"/> ATLAS · PRIVATE SESSION</div></aside><div className="grok-chat-main"><div className="grok-topbar"><div className="grok-title"><span className="grok-mark"><AtlasLogo/></span><div><b>ATLAS</b><small>GENERAL INTELLIGENCE</small></div></div><div className="grok-top-actions"><span className="grok-model-tag">AUTO MODEL</span><span className="grok-online"><i/> {gatewayReady?"ONLINE":"CONNECTING"}</span></div></div><div className="grok-messages">{messages.map((m,i)=><div className={"grok-message "+m.role} key={i}>{m.role==="atlas"&&<span className="grok-message-avatar"><AtlasLogo/></span>}<div className="grok-message-body">{m.role==="user"&&<b>YOU</b>}<p>{m.text}</p></div></div>)}</div><div className="grok-compose-area"><div className="grok-model-row"><label htmlFor="atlas-provider">MODEL</label><select id="atlas-provider" value={provider} onChange={e=>setProvider(e.target.value)}><option value="atlas">ATLAS · Auto</option><option value="nvidia" disabled={!providerStates.nvidia?.configured}>NVIDIA API Catalog{providerStates.nvidia?.configured?"":" · unavailable"}</option></select></div><form className="grok-composer" onSubmit={send}><textarea aria-label="Message ATLAS" rows="1" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form.requestSubmit();}}} placeholder="Ask ATLAS anything…"/><div className="grok-composer-bottom"><span>Enter to send · Shift + Enter for a new line</span><button aria-label="Send message" disabled={!input.trim()||generating}><Send size={17}/></button></div></form><small>{generating?"ATLAS is thinking…":"AI can make mistakes. Verify important information."}</small></div></div></div></section>
  : page==="Copilot" ? <section className="stack grok-page"><div className="grok-workspace"><aside className="grok-history"><button className="grok-new-chat" onClick={newCopilotConversation}><Plus size={17}/> <span>New chat</span></button><div className="grok-history-label">COPILOT CHATS</div><div className="grok-history-list" aria-label="Copilot conversation history">{copilotConversations.map(item=><div className={item.id===activeCopilotConversation?.id?"grok-history-item active":"grok-history-item"} key={item.id}><button className="grok-history-open" onClick={()=>{setActiveCopilotConversationId(item.id);localStorage.setItem("atlas-active-copilot-conversation",item.id);setInput("");}} title={item.title}>{item.title}</button><button className="grok-history-delete" onClick={()=>deleteCopilotConversation(item.id)} aria-label={"Delete "+item.title} title="Delete Copilot conversation"><Trash2 size={14}/></button></div>)}</div><div className="grok-history-foot"><span className="grok-status-dot"/> ATLAS COPILOT · PRIVATE SESSION</div></aside><div className="grok-chat-main"><div className="grok-topbar"><div className="grok-title"><span className="grok-mark"><AtlasLogo/></span><div><b>ATLAS Copilot</b><small>SOFTWARE ENGINEERING</small></div></div><div className="grok-top-actions"><span className="grok-model-tag">CODING MODE</span><span className="grok-online"><i/> {gatewayReady?"ONLINE":"CONNECTING"}</span></div></div><div className="grok-messages">{copilotMessages.map((m,i)=><div className={"grok-message "+m.role} key={i}>{m.role==="atlas"&&<span className="grok-message-avatar"><AtlasLogo/></span>}<div className="grok-message-body">{m.role==="user"&&<b>YOU</b>}<p>{m.text}</p></div></div>)}</div><div className="grok-compose-area"><div className="grok-composer-hint">Ask Copilot to write, explain, debug, or review code.</div><form className="grok-composer" onSubmit={send}><textarea aria-label="Message ATLAS Copilot" rows="1" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form.requestSubmit();}}} placeholder="Ask ATLAS Copilot about your code…"/><div className="grok-composer-bottom"><span>Enter to send · Shift + Enter for a new line</span><button aria-label="Send message" disabled={!input.trim()||generating}><Send size={17}/></button></div></form><small>{generating?"Copilot is thinking…":"AI can make mistakes. Review generated code before using it."}</small></div></div></div></section>
  : page==="Vision Center" ? <section className="stack">{heading(page,"Prepare image input for future computer-vision features.","NOT CONNECTED")}<div className="panel"><Camera size={30}/><h3>Image input</h3><p>Choose a picture from your phone to preview it here. This prototype does not send images to an AI model.</p><label className="button">Choose image<input hidden type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f){setImage(URL.createObjectURL(f));setNotice("Local preview only. AI analysis is not connected.")}}}/></label>{image&&<img className="preview" src={image} alt="Selected preview"/>}{notice&&<p className="notice">{notice}</p>}</div>{card(<ShieldCheck/>,"Planned vision capabilities","Object recognition, camera integration, visual Q&A and privacy controls.")}</section>
  : page==="Voice Center" ? <section className="stack voice-session-screen" aria-label="ATLAS voice center">{heading("ATLAS Voice Center","Speak to ATLAS when you choose, then hear its spoken reply. The microphone is never activated automatically.","OPT-IN VOICE")}<div className="panel voice-tts-panel"><div className="voice-tts-status" role="status" aria-live="polite"><Volume2 size={18}/><span>{voiceStatus}</span></div><div className="grok-messages voice-tts-messages">{messages.map((m,i)=><div className={"grok-message "+m.role} key={i}>{m.role==="atlas"&&<span className="grok-message-avatar"><AtlasLogo/></span>}<div className="grok-message-body">{m.role==="user"&&<b>YOU</b>}<p>{m.text}</p></div></div>)}</div><div className="voice-input-controls"><button type="button" className={isListening?"voice-mic-button listening":"voice-mic-button"} onClick={isListening?stopVoiceInput:startVoiceInput} disabled={generating||(!voiceInputAvailable&&!isListening)} aria-pressed={isListening}><Mic size={18}/>{isListening?"Finish & send":"Speak to ATLAS"}</button>{isListening&&<button type="button" className="secondary" onClick={cancelVoiceInput}><MicOff size={16}/> Cancel</button>}</div><small className="voice-privacy-note">Microphone is used only after you tap “Speak to ATLAS”. Each turn ends after you finish speaking; ATLAS never listens in the background.</small><form className="grok-composer voice-tts-composer" onSubmit={send}><textarea aria-label="Message ATLAS Voice Center" rows="2" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form.requestSubmit();}}} placeholder="Or type a message for ATLAS…"/><div className="grok-composer-bottom"><span>Type instead · ATLAS speaks the reply</span><button aria-label="Send message" disabled={!input.trim()||generating||isListening}><Send size={17}/></button></div></form><button type="button" className="secondary" onClick={()=>{stopSpeechPlayback();setVoiceStatus("Spoken reply stopped.");}}><Volume2 size={16}/> Stop spoken reply</button><small>{generating?"ATLAS is thinking…":isListening?"Listening only for this turn…":voiceInputAvailable?"Ready. Microphone is off until you tap Speak to ATLAS.":"Voice input is unavailable in this browser; typed chat and spoken replies remain available."}</small></div></section>
  : page==="Memory" ? <section className="stack">{heading("Project Memory","Notes are stored in this browser on this device.")}<div className="toolbar"><span>{memory.length} saved notes</span><button onClick={addMemory}>+ Add memory</button></div>{memory.map((m,i)=><div className="memory" key={i}><Database/><p>{m}</p><button className="delete" onClick={()=>setMemory(a=>a.filter((_,n)=>n!==i))}>Delete</button></div>)}<p className="notice">Notes are stored locally. They are not synced to a server or shared across devices.</p></section>
  : page==="Learning" ? <section className="stack">{heading("Learning Lab","Plan skills and training experiments for ATLAS.","PLANNING")}<div className="grid two">{card(<Sparkles/>,"Demonstration learning","Record human demonstrations and turn them into reviewed task examples.")}{card(<Activity/>,"Feedback & evaluation","Track outcomes in simulation and compare test runs.")}{card(<BrainCircuit/>,"Skill library","Store versioned, reviewed skills with clear permissions.")}{card(<ShieldCheck/>,"Safe testing","Require simulation, supervised trials and an emergency stop.","Required")}</div></section>
  : page==="Robotics" ? <section className="stack robotics-page">{heading("Robotics Center","Universal hardware integration · vendor-neutral adapter architecture.","MULTI-TRANSPORT HUB")}<div className="robotics-status"><div className="robotics-status-icon"><Bot size={27}/></div><div><b>ATLAS Integrated Robotics Bridge</b><p>The connection manager lives inside ATLAS. It is designed to connect to compatible robots, vehicles, sensors and industrial equipment across Bluetooth, Wi-Fi, USB, Ethernet, CAN adapters and network protocols. Each transport is shown with its real implementation status; a planned adapter is not presented as a working connection.</p></div><span className="badge">SIMULATION READY</span></div><div className="robotics-section-head"><div><h2>UNIVERSAL CONNECTION HUB</h2><p>One connection manager for phone radios, wired adapters, vehicle buses, industrial networks and robotics middleware.</p></div><span className="badge">{roboticsTransportCatalog.length} TRANSPORTS</span></div><div className="robotics-transport-grid">{roboticsTransportCatalog.map(item=><article className="card robotics-adapter" key={item.id}><div className="cardtop"><span className="cardicon"><Radio size={18}/></span><span className={"badge transport-state "+item.state}>{item.state==="available"?"Available":item.state==="implemented"?"Implemented":"Planned"}</span></div><h3>{item.name}</h3><small className="transport-group">{item.group}</small><p>{item.scope}</p><div className="transport-route">Connection path: {item.route}</div></article>)}</div><div className="robot-discovery-panel"><div className="robot-discovery-copy"><b>LIVE BLUETOOTH LE DISCOVERY</b><p>{robotDiscoveryCapability.reason}</p><small>{robotBluetoothDevice?`${robotBluetoothDevice.name} · ${robotBluetoothDevice.connection}`:robotDiscoveredDevices.length?`${robotDiscoveredDevices.length} nearby device(s) discovered`:"No device selected"}</small><small className="robot-discovery-feedback">{robotDiscoveryMessage}</small>{robotDiscoveredDevices.length>0&&<ul className="robot-discovered-list">{robotDiscoveredDevices.map(device=><li key={device.id}><b>{device.name}</b><span>{device.transport} · {device.rssi===null||device.rssi===undefined?"signal unavailable":`${device.rssi} dBm`} · {device.connection}</span></li>)}</ul>}</div><div className="robot-discovery-actions"><span className="badge">{robotBluetoothDevice?.connected?"CONNECTED":robotDiscoveryCapability.supported?"READY TO SCAN":"API UNAVAILABLE"}</span><button onClick={startRobotDiscovery} disabled={!robotDiscoveryCapability.supported||robotDiscoveryBusy}>{robotDiscoveryBusy?"Searching…":"Discover Bluetooth devices"}</button>{robotBluetoothDevice&&<button className="secondary" onClick={disconnectRobotDevice}>Disconnect</button>}</div></div><div className="robotics-section-head"><div><h2>INTEGRATION LAYERS</h2><p>Discovery and telemetry first; actuation remains locked out.</p></div></div><div className="grid two">{card(<Activity/>,"Device discovery",robotBluetoothDevice?`Selected ${robotBluetoothDevice.name}; ${robotBluetoothDevice.connection}.`:"Live Bluetooth discovery is available when this browser exposes Web Bluetooth. USB, Wi-Fi and native Android adapters remain pending.",robotBluetoothDevice?.connected?"Connected":robotDiscoveryCapability.supported?"Ready":"Unavailable")}{card(<Database/>,"Sensor telemetry","Read-only, timestamped and unit-labelled sensor data with stale-data detection.","Not connected")}{card(<ShieldCheck/>,"Safety supervisor","Independent hardware emergency stop, watchdog, interlocks and operator authorization.","Required")}{card(<BrainCircuit/>,"Simulation first","Validate adapter contracts and sensor streams against mock devices before hardware trials.","Planned")}</div><div className="robotics-section-head"><div><h2>MOTION LAB · SIMULATION</h2><p>Motion is enabled in the virtual robot simulator. This does not move connected physical hardware.</p></div><span className="badge">SIMULATION ACTIVE</span></div><div className="robot-motion-lab"><div className="robot-motion-stage"><div className="robot-motion-track"><div className="robot-motion-unit" style={{left:`calc(${robotSimPosition}% - 24px)`}}><Bot size={28}/></div></div><div className="robot-motion-scale"><span>0%</span><span>Virtual travel</span><span>100%</span></div><div className="robot-motion-readout"><span>POSITION <b>{robotSimPosition.toFixed(0)}%</b></span><span>SIMULATED SPEED <b>{robotSimSpeed}%</b></span><span>STATE <b>{robotSimRunning?"MOVING":"PAUSED"}</b></span></div></div><div className="robot-motion-controls"><label htmlFor="robot-sim-speed">Simulation speed</label><input id="robot-sim-speed" type="range" min="5" max="100" value={robotSimSpeed} onChange={event=>setRobotSimSpeed(Number(event.target.value))}/><div className="robot-motion-buttons"><button onClick={()=>setRobotSimRunning(value=>!value)}>{robotSimRunning?"Pause motion":"Start motion"}</button><button className="secondary" onClick={()=>{setRobotSimRunning(false);setRobotSimPosition(0);setRobotSimDirection(1);}}>Reset simulation</button></div></div></div><div className="safety"><ShieldCheck/><div><b>Physical hardware motion remains locked</b><p>Only virtual motion is enabled here. ATLAS does not send motor, actuator, servo or gripper commands to real equipment. Physical motion requires a separately reviewed safety design, independent emergency stop and verified hardware safeguards.</p></div></div><p className="notice">Plugin architecture specification: <code>docs/ROBOTICS_PLUGIN_ARCHITECTURE.md</code>. No robot is paired. Bluetooth discovery uses the browser device picker where supported. Native Android BLE scanning is integrated in the APK. USB OTG, Wi-Fi peer discovery and sensor-specific read-only adapters remain pending. No control or movement commands are sent.</p></section>
  : <section className="stack">{heading("Settings","Prototype configuration and system information.")}<div className="panel settings">{[["Application","ATLAS AI v1.0 prototype"],["Architecture","Hybrid cloud + edge (planned)"],["AI engine","Cloudflare Workers AI · Llama 3.3 + fallbacks"],["Memory storage","This device / browser"],["Robot connection","Integrated bridge · hardware adapters planned"],["Motion mode","Simulation enabled · physical actuation locked"]].map(([a,b])=><div className="setting" key={a}><span>{a}</span><b>{b}</b></div>)}</div><p className="notice">Never paste API keys or passwords into chat messages or public code. Store model-provider credentials only in private server-side environment variables.</p></section>;
  return <div className="app"><aside className={menu?"sidebar open":"sidebar"}><div className="brand"><AtlasLogo className="logo-brand"/><div><b>ATLAS<span>AI</span></b><small>PHYSICAL INTELLIGENCE</small></div><button className="x" onClick={()=>setMenu(false)}><X/></button></div><label>WORKSPACE</label><nav>{nav.map(([n,I])=><button className={page===n?"active":""} key={n} onClick={()=>{setPage(n);setMenu(false)}}><I size={18}/>{n}</button>)}</nav><div className="sidefoot"><b>● Cloud AI gateway</b><p>General chat uses the hosted Llama 3.3 primary model and fallbacks. Local memory remains on this device.</p><small>ATLAS BUILD 0.5.0 · CLOUD MODEL</small></div></aside><main><header className="top"><button className="hamb" onClick={()=>setMenu(true)}><Menu/></button><span>ATLAS　›　<b>{page}</b></span><small>● Prototype</small></header><div className="content">{content}</div></main>{menu&&<button className="scrim" onClick={()=>setMenu(false)} aria-label="Close navigation"/>}</div>;
}