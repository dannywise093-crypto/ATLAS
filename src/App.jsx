import React, { useEffect, useRef, useState } from "react";
import { runAtlasCore } from "./atlasCore.js";
import { getBluetoothDiscoveryStatus, discoverBluetoothDevice, scanNativeBluetoothDevices, connectNativeBleSensorDevice, disconnectNativeBleDevice, readWebBleEnvironmentalSensors } from "./roboticsDiscovery.js";
import { Capacitor } from "@capacitor/core";
import { getRoboticsTransportCatalog } from "./roboticsTransports.js";
import { speakText, stopSpeechPlayback } from "./voiceInterface.js";
import { createCloudflareVoice } from "./cloudflareVoice.js";
import { Code2 } from "lucide-react";
import CopilotMessage from "./CopilotMessage.jsx";
import { getNeuralRuntimeStatus, checkAtlasBackend, generateAtlasResponse, generateAtlasCopilotResponse, generateProviderResponse } from "./modelRuntime.js";
import { Activity, Bot, BrainCircuit, Camera, Check, Database, Eye, GraduationCap, Home, Menu, MessageSquare, Mic, Plus, Radio, Search, Send, Settings, ShieldCheck, Sparkles, Trash2, Volume2, X } from "lucide-react";

function atlasStorageKey(key) {
  // NEXORA AI is now an open workspace: chat and settings use device-local keys,
  // not an authenticated Google account. Migrate existing conversations once.
  const storageKey = "atlas:" + key;
  try {
    if (localStorage.getItem(storageKey) === null) {
      const userId = localStorage.getItem("atlas-user-scope");
      const legacyKeys = [
        userId ? "atlas-user:" + userId + ":" + key : null,
        "atlas-user:unavailable:" + key
      ].filter(Boolean);
      for (const legacyKey of legacyKeys) {
        const value = localStorage.getItem(legacyKey);
        if (value !== null) {
          localStorage.setItem(storageKey, value);
          break;
        }
      }
    }
    localStorage.removeItem("atlas-user-scope");
  } catch {}
  return storageKey;
}

function AtlasLogo({ className = "" }) {
  return <img className={className} src="/nexora-logo.svg" alt="NEXORA AI logo" />;
}

const initial = [
  { role: "atlas", text: "Welcome to NEXORA AI. I’m your general-purpose AI assistant, connected through the secured Cloudflare model gateway. I can help with research, engineering, software development, reasoning, and the specialist skill library. Ask a question to get started." },
  { role: "atlas", text: "Your conversation is routed through the configured hosted model. Relevant skill references are selected automatically when they match your request." }
];
const nav = [["Overview",Home],["AI Assistant",MessageSquare],["Research Center",Search],["Copilot",Code2],["Vision Center",Eye],["Voice Center",Mic],["Memory",Database],["Learning",GraduationCap],["Robotics",Bot],["Settings",Settings]];

function AtlasWorkspace() {
  const [page,setPage] = useState("Overview");
  const [conversations,setConversations] = useState(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem(atlasStorageKey("atlas-conversations")));
      if(Array.isArray(saved)&&saved.length)return saved;
      const legacy=JSON.parse(localStorage.getItem(atlasStorageKey("atlas-messages")));
      return [{id:crypto.randomUUID(),title:"Welcome to NEXORA AI",messages:Array.isArray(legacy)&&legacy.length?legacy:initial,updatedAt:Date.now()}];
    } catch { return [{id:crypto.randomUUID(),title:"Welcome to NEXORA AI",messages:initial,updatedAt:Date.now()}]; }
  });
  const conversationsRef = useRef(conversations);
  const sendInProgressRef = useRef(false);
  const [activeConversationId,setActiveConversationId] = useState(()=>{
    try{return localStorage.getItem(atlasStorageKey("atlas-active-conversation"))||"";}catch{return "";}
  });
  const activeConversation=conversations.find(item=>item.id===activeConversationId)||conversations[0];
  const messages=activeConversation?.messages||initial;
  const copilotWelcome=[{role:"atlas",text:"NEXORA Copilot is ready for coding questions, complete implementations, debugging, and code reviews."}];
  const [copilotConversations,setCopilotConversations] = useState(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem(atlasStorageKey("atlas-copilot-conversations")));
      if(Array.isArray(saved)&&saved.length)return saved;
      const legacy=JSON.parse(localStorage.getItem(atlasStorageKey("atlas-copilot-messages")));
      return [{id:crypto.randomUUID(),title:"Welcome to Copilot",messages:Array.isArray(legacy)&&legacy.length?legacy:copilotWelcome,updatedAt:Date.now()}];
    } catch { return [{id:crypto.randomUUID(),title:"Welcome to Copilot",messages:copilotWelcome,updatedAt:Date.now()}]; }
  });
  const copilotConversationsRef = useRef(copilotConversations);
  const [activeCopilotConversationId,setActiveCopilotConversationId] = useState(()=>{
    try{return localStorage.getItem(atlasStorageKey("atlas-active-copilot-conversation"))||"";}catch{return "";}
  });
  const activeCopilotConversation=copilotConversations.find(item=>item.id===activeCopilotConversationId)||copilotConversations[0];
  const copilotMessages=activeCopilotConversation?.messages||copilotWelcome;
  const [memory,setMemory] = useState(()=>{try{return JSON.parse(localStorage.getItem(atlasStorageKey("atlas-memory")))||["NEXORA AI is a general-purpose engineering and research intelligence platform.","Architecture preference: hybrid cloud and local computing."]}catch{return []}});
  const [input,setInput] = useState("");
  const [provider,setProvider] = useState(()=>localStorage.getItem(atlasStorageKey("atlas-provider"))||"atlas");
  const [providerStates,setProviderStates] = useState({});
  useEffect(()=>{fetch("/api/providers").then(r=>r.ok?r.json():{}).then(data=>setProviderStates(data.providers||{})).catch(()=>setProviderStates({}));},[]);
  useEffect(()=>localStorage.setItem(atlasStorageKey("atlas-provider"),provider),[provider]);
  const [image,setImage] = useState("");
  const [menu,setMenu] = useState(false);
  const [notice,setNotice] = useState("");
  const [generating,setGenerating] = useState(false);
  const [researchQuery,setResearchQuery] = useState(()=>{try{return localStorage.getItem(atlasStorageKey("research-query"))||"";}catch{return "";}});
  const [researchAvailable,setResearchAvailable] = useState(false);
  const [researchStatus,setResearchStatus] = useState("Research backend has not been checked.");
  const [researchBusy,setResearchBusy] = useState(false);
  const [researchJobId,setResearchJobId] = useState(()=>{try{return localStorage.getItem(atlasStorageKey("research-job-id"))||"";}catch{return "";}});
  const [researchProgress,setResearchProgress] = useState([]);
  const [researchReport,setResearchReport] = useState(null);
  const [researchError,setResearchError] = useState("");
  const [researchVisualQuery,setResearchVisualQuery] = useState("");
  const [researchImages,setResearchImages] = useState([]);
  const [researchVisualBusy,setResearchVisualBusy] = useState(false);
  const [researchVisualError,setResearchVisualError] = useState("");
  const [researchImagePrompt,setResearchImagePrompt] = useState("");
  const [generatedResearchImage,setGeneratedResearchImage] = useState(null);
  const [imageGenerating,setImageGenerating] = useState(false);

  useEffect(()=>{try{if(researchJobId)localStorage.setItem(atlasStorageKey("research-job-id"),researchJobId);else localStorage.removeItem(atlasStorageKey("research-job-id"));}catch{}},[researchJobId]);
  useEffect(()=>{try{if(researchQuery.trim())localStorage.setItem(atlasStorageKey("research-query"),researchQuery);else localStorage.removeItem(atlasStorageKey("research-query"));}catch{}},[researchQuery]);
  useEffect(()=>{
    if(page!=="Research Center")return;
    const controller=new AbortController();
    fetch("/api/research/agents",{signal:controller.signal}).then(async response=>{
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Research backend is unavailable.");
      const agents=Array.isArray(data.agents)?data.agents:[];
      setResearchAvailable(agents.some(agent=>agent.agent_type==="deep_researcher"));
      setResearchStatus(agents.length?"NVIDIA Deep Researcher API is reachable.":"Backend reachable, but no research agent is configured.");
    }).catch(error=>{if(error.name!=="AbortError"){setResearchAvailable(false);setResearchStatus(error.message);}});
    return()=>controller.abort();
  },[page]);
  const [voiceMode,setVoiceMode] = useState(false);
  const [voiceStatus,setVoiceStatus] = useState("Voice assistant is idle.");
  const [voiceTranscript,setVoiceTranscript] = useState("");
  const voiceModeRef = useRef(false);
  const cloudVoiceSessionRef = useRef(null);
  const [robotSimRunning,setRobotSimRunning] = useState(false);
  const [robotSimPosition,setRobotSimPosition] = useState(0);
  const [robotSimSpeed,setRobotSimSpeed] = useState(35);
  const [robotSimDirection,setRobotSimDirection] = useState(1);
  const [robotDiscoveryCapability] = useState(()=>getBluetoothDiscoveryStatus({...globalThis,Capacitor}));
  const [robotDiscoveryBusy,setRobotDiscoveryBusy] = useState(false);
  const [robotDiscoveryMessage,setRobotDiscoveryMessage] = useState("Ready to check nearby Bluetooth devices.");
  const [robotBluetoothDevice,setRobotBluetoothDevice] = useState(null);
  const [robotDiscoveredDevices,setRobotDiscoveredDevices] = useState([]);
  const [robotSensorReadings,setRobotSensorReadings] = useState([]);
  const [robotSensorBusy,setRobotSensorBusy] = useState(false);
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
  useEffect(()=>{const controller=new AbortController();checkAtlasBackend(controller.signal).then(status=>{const ready=status.status==="configured";setGatewayReady(ready);setGatewayMessage(ready?(status.provider||"Cloudflare Workers AI")+" is connected.":"The hosted model is not configured.");}).catch(error=>{setGatewayReady(false);setGatewayMessage(error.message);});return()=>controller.abort();},[]);
  function commitConversations(updater){
    const current=conversationsRef.current;
    const next=typeof updater==="function"?updater(current):updater;
    conversationsRef.current=next;
    setConversations(next);
    try{localStorage.setItem(atlasStorageKey("atlas-conversations"),JSON.stringify(next));}
    catch(error){console.warn("NEXORA could not persist chat history locally.",error);}
  }
  function commitCopilotConversations(updater){
    const current=copilotConversationsRef.current;
    const next=typeof updater==="function"?updater(current):updater;
    copilotConversationsRef.current=next;
    setCopilotConversations(next);
    try{localStorage.setItem(atlasStorageKey("atlas-copilot-conversations"),JSON.stringify(next));}
    catch(error){console.warn("NEXORA could not persist Copilot history locally.",error);}
  }
  useEffect(()=>{try{localStorage.setItem(atlasStorageKey("atlas-conversations"),JSON.stringify(conversations));}catch(error){console.warn("NEXORA chat history persistence failed.",error);}},[conversations]);
  useEffect(()=>{if(activeConversation?.id){setActiveConversationId(activeConversation.id);localStorage.setItem(atlasStorageKey("atlas-active-conversation"),activeConversation.id);}},[activeConversation?.id]);
  useEffect(()=>{try{localStorage.setItem(atlasStorageKey("atlas-copilot-conversations"),JSON.stringify(copilotConversations));}catch(error){console.warn("NEXORA Copilot history persistence failed.",error);}},[copilotConversations]);
  useEffect(()=>{if(activeCopilotConversation?.id){setActiveCopilotConversationId(activeCopilotConversation.id);localStorage.setItem(atlasStorageKey("atlas-active-copilot-conversation"),activeCopilotConversation.id);}},[activeCopilotConversation?.id]);
  useEffect(()=>localStorage.setItem(atlasStorageKey("atlas-memory"),JSON.stringify(memory)),[memory]);
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
    localStorage.setItem(atlasStorageKey("atlas-active-conversation"),id);
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
      if(activeConversationId===id){setActiveConversationId(remaining[0].id);localStorage.setItem(atlasStorageKey("atlas-active-conversation"),remaining[0].id);}
    }else{
      const fresh={id:crypto.randomUUID(),title:"New conversation",messages:initial,updatedAt:Date.now()};
      commitConversations([fresh]);setActiveConversationId(fresh.id);localStorage.setItem(atlasStorageKey("atlas-active-conversation"),fresh.id);
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
    localStorage.setItem(atlasStorageKey("atlas-active-copilot-conversation"),id);
    setInput("");
    setPage("Copilot");
  }
  function deleteCopilotConversation(id){
    if(!copilotConversations.some(item=>item.id===id))return;
    if(!window.confirm("Delete this Copilot conversation permanently from this device?"))return;
    const remaining=copilotConversations.filter(item=>item.id!==id);
    if(remaining.length){
      commitCopilotConversations(remaining);
      if(activeCopilotConversationId===id){setActiveCopilotConversationId(remaining[0].id);localStorage.setItem(atlasStorageKey("atlas-active-copilot-conversation"),remaining[0].id);}
    }else{
      const fresh={id:crypto.randomUUID(),title:"New Copilot chat",messages:copilotWelcome,updatedAt:Date.now()};
      commitCopilotConversations([fresh]);setActiveCopilotConversationId(fresh.id);localStorage.setItem(atlasStorageKey("atlas-active-copilot-conversation"),fresh.id);
    }
  }
  async function speakVoiceReply(text){
    if(!voiceModeRef.current)return;
    setVoiceStatus("Speaking. You can stop the conversation at any time.");
    cloudVoiceSessionRef.current?.pause?.();
    try{
      await speakText(text);
    }catch(error){
      if(voiceModeRef.current)setVoiceStatus("Spoken response unavailable: "+error.message);
    }finally{
      if(voiceModeRef.current)cloudVoiceSessionRef.current?.resume?.();
    }
    if(voiceModeRef.current){
      setVoiceTranscript("");
      setVoiceStatus("Listening. Speak naturally; NEXORA AI is ready.");
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
    // Clear both chat composers immediately after accepting the message.
    // The submitted text is already persisted in the conversation history.
    setInput("");
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
      const failure={role:"atlas",text:`I couldn't reach the NEXORA AI language-model service. ${error.message} Your message remains in this chat. Please retry when the gateway is available.`};
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
  async function searchResearchImages(query=researchVisualQuery||researchQuery){
    const topic=String(query||"").trim();
    if(!topic)return;
    setResearchVisualBusy(true);
    setResearchVisualError("");
    setResearchVisualQuery(topic);
    try{
      const response=await fetch("/api/visuals/search?q="+encodeURIComponent(topic));
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Image search failed.");
      setResearchImages(Array.isArray(data.images)?data.images:[]);
      if(!data.images?.length)setResearchVisualError("No appropriately licensed images with usable attribution were found for this topic.");
    }catch(error){setResearchVisualError(error.message||"Could not retrieve research images.");}
    finally{setResearchVisualBusy(false);}
  }
  async function generateResearchIllustration(){
    const prompt=(researchImagePrompt.trim()||researchQuery.trim());
    if(!prompt||imageGenerating)return;
    setImageGenerating(true);
    setResearchVisualError("");
    setGeneratedResearchImage(null);
    try{
      const response=await fetch("/api/visuals/generate",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompt:"Create a clear, accurate-looking educational research illustration about: "+prompt+". Use a clean scientific editorial style, uncluttered composition, neutral background, and visual labels only where legible. Do not invent numerical data, citations, or claim to depict a real measurement."})
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Image generation failed.");
      if(!data.generated||typeof data.image!=="string"||!data.image.startsWith("data:image/"))throw new Error("The image service did not return a valid generated image.");
      setGeneratedResearchImage(data);
    }catch(error){setResearchVisualError(error.message||"Could not generate the research illustration.");}
    finally{setImageGenerating(false);}
  }
  async function loadResearchReport(jobId=researchJobId){
    if(!jobId)return;
    setResearchError("");
    try{
      const response=await fetch("/api/research/job/"+encodeURIComponent(jobId)+"/report");
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.detail?.message||data.error||"The report is not available yet.");
      setResearchReport(data);
      setResearchStatus("Research report loaded. Finding real source images…");
      searchResearchImages(researchQuery);
      setResearchStatus("Research report loaded.");
      return data;
    }catch(error){setResearchError(error.message);return null;}
  }
  async function runDeepResearch(event){
    event.preventDefault();
    const question=researchQuery.trim();
    if(!question||researchBusy)return;
    setResearchBusy(true);
    setResearchError("");
    setResearchReport(null);
    setResearchProgress(["Submitting research request…"]);
    setResearchStatus("Submitting to NVIDIA Deep Researcher…");
    try{
      const submit=await fetch("/api/research/submit",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({agent_type:"deep_researcher",input:question})
      });
      const submitted=await submit.json().catch(()=>({}));
      if(!submit.ok)throw new Error(submitted.detail?.message||submitted.error||"Research submission failed.");
      const jobId=submitted.job_id;
      if(typeof jobId!=="string"||!jobId)throw new Error("The research service did not return a job ID.");
      setResearchJobId(jobId);
      setResearchProgress(items=>[...items,"Research job created: "+jobId]);
      setResearchStatus("Research is running. Receiving live progress…");

      try{
        const stream=await fetch("/api/research/job/"+encodeURIComponent(jobId)+"/stream");
        if(stream.ok&&stream.body){
          const reader=stream.body.getReader();
          const decoder=new TextDecoder();
          let buffer="";
          while(true){
            const part=await reader.read();
            if(part.done)break;
            buffer+=decoder.decode(part.value,{stream:true});
            const frames=buffer.split(/\r?\n\r?\n/);
            buffer=frames.pop()||"";
            for(const frame of frames){
              const eventName=(frame.match(/^event:\s*(.+)$/m)||[])[1]||"research";
              const dataLine=(frame.match(/^data:\s*(.*)$/m)||[])[1];
              if(!dataLine)continue;
              let payload;
              try{payload=JSON.parse(dataLine);}catch{payload={message:dataLine};}
              const detail=payload.status||payload.message||payload.agent_type||payload.title||JSON.stringify(payload);
              setResearchProgress(items=>[...items.slice(-29),eventName+": "+String(detail).slice(0,240)]);
            }
          }
        }else{
          setResearchProgress(items=>[...items,"Live progress stream unavailable; checking job status instead."]);
        }
      }catch(streamError){
        setResearchProgress(items=>[...items,"Live stream interrupted; checking job status."]);
      }

      let completed=false;
      for(let attempt=0;attempt<90;attempt++){
        const statusResponse=await fetch("/api/research/job/"+encodeURIComponent(jobId));
        const statusData=await statusResponse.json().catch(()=>({}));
        if(statusResponse.ok){
          const status=String(statusData.status||statusData.job?.status||statusData.job_info?.status||"").toLowerCase();
          if(["success","completed","complete"].includes(status)){
            completed=true;
            break;
          }
          if(["failure","failed","error","cancelled","interrupted"].includes(status)){
            throw new Error(statusData.error||statusData.detail?.message||"The research job ended with status: "+status);
          }
        }
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
      if(!completed)throw new Error("The research job is still running. Its ID has been saved; use Refresh report to check again.");
      const finalReport=await loadResearchReport(jobId);
      if(!finalReport)throw new Error("The research job finished, but its final report could not be loaded. Use Refresh report to try again.");
      setResearchStatus("Deep research completed.");
    }catch(error){
      setResearchError(error.message);
      setResearchStatus("Research did not complete.");
    }finally{
      setResearchBusy(false);
    }
  }
  async function send(e){
    e.preventDefault();
    return sendMessage(input,{isCopilot:page==="Copilot"});
  }
  function stopVoiceMode(){
    voiceModeRef.current=false;
    setVoiceMode(false);
    try{cloudVoiceSessionRef.current?.stop();}catch{}
    cloudVoiceSessionRef.current=null;
    stopSpeechPlayback();
    setVoiceStatus("Voice assistant is idle. The microphone is off.");
  }
  async function startVoiceMode(){
    if(voiceModeRef.current)return;
    voiceModeRef.current=true;
    setVoiceMode(true);
    setVoiceTranscript("");
    setVoiceStatus("Starting Cloudflare Voice. Allow microphone access when prompted…");
    const session=createCloudflareVoice({
      onStatus:message=>{if(voiceModeRef.current)setVoiceStatus(message);},
      onTranscript:async text=>{
        if(!voiceModeRef.current)return;
        setVoiceTranscript(text);
        setVoiceStatus("Processing your request with NEXORA AI…");
        await sendMessage(text,{speak:true,voiceModeActive:true});
        if(voiceModeRef.current){
          setVoiceTranscript("");
          setVoiceStatus("Listening. Speak naturally; NEXORA AI is ready.");
        }
      },
      onError:error=>{
        if(voiceModeRef.current)setVoiceStatus("Cloudflare Voice: "+(error?.message||"transcription problem"));
      }
    });
    cloudVoiceSessionRef.current=session;
    try{
      await session.start();
      if(!voiceModeRef.current)session.stop();
    }catch(error){
      session.stop();
      if(cloudVoiceSessionRef.current===session)cloudVoiceSessionRef.current=null;
      if(voiceModeRef.current){
        setVoiceStatus("Cloudflare Voice unavailable: "+error.message);
        voiceModeRef.current=false;
        setVoiceMode(false);
      }
    }
  }

  useEffect(()=>{
    // Voice is opt-in: entering Voice Center must never activate the microphone.
    // Leaving the page ends an active session and releases its audio resources.
    if(page!=="Voice Center"&&voiceModeRef.current)stopVoiceMode();
  },[page]);
  useEffect(()=>()=>{voiceModeRef.current=false;try{cloudVoiceSessionRef.current?.stop();}catch{};stopSpeechPlayback();},[]);
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
  async function connectRobotSensorDevice(device){
    if(!device?.id||robotSensorBusy)return;
    setRobotSensorBusy(true);
    setRobotDiscoveryMessage("Connecting to the selected BLE device and checking its standard sensor services…");
    try{
      const result=Capacitor.isNativePlatform()
        ? await connectNativeBleSensorDevice({deviceId:device.id})
        : await readWebBleEnvironmentalSensors(device.device);
      setRobotBluetoothDevice({...device,...result});
      setRobotDiscoveredDevices(items=>items.map(item=>item.id===device.id?{...item,...result}:item));
      setRobotSensorReadings(result.sensors||[]);
      setRobotDiscoveryMessage(result.sensorStatus);
    }catch(error){
      setRobotDiscoveryMessage(error?.message||"Could not connect to this BLE device.");
    }finally{setRobotSensorBusy(false);}
  }
  async function disconnectRobotDevice(){
    try{
      if(Capacitor.isNativePlatform()&&robotBluetoothDevice?.id)await disconnectNativeBleDevice(robotBluetoothDevice.id);
      else if(robotBluetoothDevice?.device?.gatt?.connected)robotBluetoothDevice.device.gatt.disconnect();
    }catch{}
    setRobotBluetoothDevice(null);
    setRobotSensorReadings([]);
    setRobotDiscoveryMessage("Device disconnected. Ready for another discovery session.");
  }
  function addMemory(){const v=prompt("What should NEXORA AI save in project memory?");if(v?.trim())setMemory(m=>[...m,v.trim()])}
  function heading(title,sub,badge){return <header className="pagehead"><div className="headicon"><AtlasLogo className="logo-head"/></div><div><div className="headrow"><h1>{title}</h1>{badge&&<span className="badge">{badge}</span>}</div><p>{sub}</p></div></header>}
  function card(icon,title,desc,status="Planned"){return <article className="card"><div className="cardtop"><span className="cardicon">{icon}</span><span className="badge">{status}</span></div><h3>{title}</h3><p>{desc}</p></article>}
  const neuralStatus = {...getNeuralRuntimeStatus(),available:gatewayReady,reason:gatewayMessage};
  const roboticsTransportCatalog = getRoboticsTransportCatalog({nativeAndroid:Capacitor.isNativePlatform()});
  const content = page==="Overview" ? <section className="stack">
    <div className="hero"><div className="eyebrow"><AtlasLogo className="hero-logo"/> PROJECT WORKSPACE · V1.1</div><h1>Build intelligence<br/><em>that can act in the real world.</em></h1><p>NEXORA AI is a modular foundation for conversational AI, perception, learning and safe robotics integration.</p><button onClick={()=>setPage("AI Assistant")}> <MessageSquare size={16}/> Open AI assistant</button></div>
    <h2>SYSTEM OVERVIEW</h2><div className="grid four">{card(<BrainCircuit/>,"AI Core","Local intent engine connected","Local v0.2")}{card(<Sparkles/>,"Neural Runtime",neuralStatus.reason,neuralStatus.available?"Ready":"Not installed")}{card(<Database/>,"Project Memory",memory.length+" notes on this device","Local")}{card(<Eye/>,"Vision","Image preview only","Standby")}{card(<Bot/>,"Robotics","No hardware connected","Offline")}</div>
    <h2>DEVELOPMENT MODULES</h2><div className="grid two">{card(<MessageSquare/>,"Conversational intelligence","NVIDIA when configured, with Cloudflare Workers AI model fallbacks; otherwise Cloudflare Workers AI is primary.","Interface ready")}{card(<Eye/>,"Perception & vision","Prepare image inputs for future computer vision.","Preview ready")}{card(<GraduationCap/>,"Learning system","Plan supervised demonstrations and evaluation.","Planned")}{card(<Bot/>,"Robotics integration","A safe bridge to controllers after simulation and testing.","Not connected")}</div>
    <div className="safety"><ShieldCheck/><div><b>Safety-first development</b><p>This is a software prototype. It does not control physical devices. Real robot movement must use independent safety limits and supervised testing.</p></div></div>
  </section> : page==="AI Assistant" ? <section className="stack grok-page"><div className="grok-workspace"><aside className="grok-history"><button className="grok-new-chat" onClick={newConversation}><Plus size={17}/> <span>New chat</span></button><div className="grok-history-label">YOUR CHATS</div><div className="grok-history-list" aria-label="NEXORA AI conversation history">{conversations.map(item=><div className={item.id===activeConversation?.id?"grok-history-item active":"grok-history-item"} key={item.id}><button className="grok-history-open" onClick={()=>{setActiveConversationId(item.id);setInput("");}} title={item.title}>{item.title}</button><button className="grok-history-delete" onClick={()=>deleteConversation(item.id)} aria-label={"Delete "+item.title} title="Delete conversation"><Trash2 size={14}/></button></div>)}</div><div className="grok-history-foot"><span className="grok-status-dot"/> NEXORA AI · PRIVATE SESSION</div></aside><div className="grok-chat-main"><div className="grok-topbar"><div className="grok-title"><span className="grok-mark"><AtlasLogo/></span><div><b>NEXORA AI</b><small>GENERAL INTELLIGENCE</small></div></div><div className="grok-top-actions"><span className="grok-model-tag">AUTO MODEL</span><span className="grok-online"><i/> {gatewayReady?"ONLINE":"CONNECTING"}</span></div></div><div className="grok-messages">{messages.map((m,i)=><div className={"grok-message "+m.role} key={i}>{m.role==="atlas"&&<span className="grok-message-avatar"><AtlasLogo/></span>}<div className="grok-message-body">{m.role==="user"&&<b>YOU</b>}<CopilotMessage text={m.text}/></div></div>)}</div><div className="grok-compose-area"><div className="grok-model-row"><label htmlFor="atlas-provider">MODEL</label><select id="atlas-provider" value={provider} onChange={e=>setProvider(e.target.value)}><option value="atlas">NEXORA AI · Auto</option><option value="nvidia" disabled={!providerStates.nvidia?.configured}>NVIDIA API Catalog{providerStates.nvidia?.configured?"":" · unavailable"}</option></select></div><form className="grok-composer" onSubmit={send}><textarea aria-label="Message NEXORA AI" rows="1" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form.requestSubmit();}}} placeholder="Ask NEXORA AI anything…"/><div className="grok-composer-bottom"><span>Enter to send · Shift + Enter for a new line</span><button aria-label="Send message" disabled={!input.trim()||generating}><Send size={17}/></button></div></form><small>{generating?"NEXORA AI is thinking…":"AI can make mistakes. Verify important information."}</small></div></div></div></section>
  : page==="Research Center" ? <section className="stack">
    {heading("NVIDIA Deep Research Center","Run structured, multi-step research and receive a source-backed report.",researchAvailable?"BACKEND ONLINE":"BACKEND CHECK")}
    <article className="card">
      <div className="cardtop"><span className="cardicon"><Search/></span><span className="badge">{researchAvailable?"Connected":"Not connected"}</span></div>
      <p>{researchStatus}</p>
      <form onSubmit={runDeepResearch} className="stack">
        <label htmlFor="nexora-research-query">Research question</label>
        <textarea id="nexora-research-query" rows="5" maxLength="32768" value={researchQuery} onChange={event=>setResearchQuery(event.target.value)} placeholder="Describe the topic, scope, questions, and evidence you want NEXORA to investigate…" />
        <p>Mode: <b>Deep research · comprehensive, multi-step report</b></p>
        <div className="stack">
          <button type="submit" disabled={!researchQuery.trim()||researchBusy||!researchAvailable}>{researchBusy?"Research running…":"Start deep research"}</button>
          {researchJobId&&<button type="button" onClick={()=>loadResearchReport()} disabled={researchBusy}>Refresh report</button>}
        </div>
      </form>
      {researchJobId&&<p>Current job: <code>{researchJobId}</code></p>}
      {researchError&&<p role="alert">{researchError}</p>}
    </article>
    {researchProgress.length>0&&<article className="card"><h2>Research activity</h2><ol>{researchProgress.map((item,index)=><li key={index}>{item}</li>)}</ol></article>}
    {researchReport&&<article className="card"><h2>Research report</h2><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{typeof researchReport==="string"?researchReport:JSON.stringify(researchReport,null,2)}</pre></article>}
    {researchReport&&<article className="card research-visual-card">
      <div className="cardtop"><span className="cardicon"><Eye/></span><span className="badge">VISUAL RESEARCH</span></div>
      <h2>Research images & illustrations</h2>
      <p>Real images are retrieved from Wikimedia Commons with creator and license details. AI illustrations are labelled separately and are not evidence or measured results.</p>
      <form className="research-visual-search" onSubmit={event=>{event.preventDefault();searchResearchImages();}}>
        <label htmlFor="research-visual-query">Find real source images</label>
        <input id="research-visual-query" value={researchVisualQuery||researchQuery} onChange={event=>setResearchVisualQuery(event.target.value)} maxLength={240} placeholder="Search photos, diagrams, maps or charts"/>
        <button type="submit" disabled={researchVisualBusy||!(researchVisualQuery||researchQuery).trim()}>{researchVisualBusy?"Searching…":"Search real images"}</button>
      </form>
      {researchVisualError&&<p className="research-visual-error" role="alert">{researchVisualError}</p>}
      {researchImages.length>0&&<div className="research-image-grid">{researchImages.map((item,index)=><figure className="research-image-result" key={item.sourceUrl||index}>
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"><img src={item.imageUrl} alt={item.title||"Research image"} loading="lazy"/></a>
        <figcaption><b>{item.title||"Untitled image"}</b><span>Creator: {item.author}</span><span>License: {item.license}{item.licenseUrl?" · ":""}{item.licenseUrl&&<a href={item.licenseUrl} target="_blank" rel="noopener noreferrer">license details</a>}</span><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">View original source ↗</a></figcaption>
      </figure>)}</div>}
      <div className="research-image-generator">
        <h3>Generate an original research illustration</h3>
        <label htmlFor="research-image-prompt">Image prompt (optional)</label>
        <textarea id="research-image-prompt" rows="3" maxLength={1600} value={researchImagePrompt} onChange={event=>setResearchImagePrompt(event.target.value)} placeholder="Describe the scientific concept or visual explanation to illustrate…"/>
        <button type="button" onClick={generateResearchIllustration} disabled={imageGenerating||!(researchImagePrompt.trim()||researchQuery.trim())}>{imageGenerating?"Generating image…":"Generate AI illustration"}</button>
        {generatedResearchImage&&<figure className="research-generated-image"><img src={generatedResearchImage.image} alt="AI-generated conceptual research illustration"/><figcaption><b>AI-generated conceptual illustration</b><span>Model: {generatedResearchImage.model}</span><span>{generatedResearchImage.note}</span></figcaption></figure>}
        <small>Image generation uses Cloudflare Workers AI and is subject to your account's available usage quota and pricing.</small>
      </div>
    </article>}
  </section>
  : page==="Copilot" ? <section className="stack grok-page"><div className="grok-workspace"><aside className="grok-history"><button className="grok-new-chat" onClick={newCopilotConversation}><Plus size={17}/> <span>New chat</span></button><div className="grok-history-label">COPILOT CHATS</div><div className="grok-history-list" aria-label="Copilot conversation history">{copilotConversations.map(item=><div className={item.id===activeCopilotConversation?.id?"grok-history-item active":"grok-history-item"} key={item.id}><button className="grok-history-open" onClick={()=>{setActiveCopilotConversationId(item.id);localStorage.setItem(atlasStorageKey("atlas-active-copilot-conversation"),item.id);setInput("");}} title={item.title}>{item.title}</button><button className="grok-history-delete" onClick={()=>deleteCopilotConversation(item.id)} aria-label={"Delete "+item.title} title="Delete Copilot conversation"><Trash2 size={14}/></button></div>)}</div><div className="grok-history-foot"><span className="grok-status-dot"/> ATLAS COPILOT · PRIVATE SESSION</div></aside><div className="grok-chat-main"><div className="grok-topbar"><div className="grok-title"><span className="grok-mark"><AtlasLogo/></span><div><b>NEXORA Copilot</b><small>SOFTWARE ENGINEERING</small></div></div><div className="grok-top-actions"><span className="grok-model-tag">CODING MODE</span><span className="grok-online"><i/> {gatewayReady?"ONLINE":"CONNECTING"}</span></div></div><div className="grok-messages">{copilotMessages.map((m,i)=><div className={"grok-message "+m.role} key={i}>{m.role==="atlas"&&<span className="grok-message-avatar"><AtlasLogo/></span>}<div className="grok-message-body">{m.role==="user"&&<b>YOU</b>}<p>{m.text}</p></div></div>)}</div><div className="grok-compose-area"><div className="grok-composer-hint">Ask Copilot to write, explain, debug, or review code.</div><form className="grok-composer" onSubmit={send}><textarea aria-label="Message NEXORA Copilot" rows="1" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();e.currentTarget.form.requestSubmit();}}} placeholder="Ask NEXORA Copilot about your code…"/><div className="grok-composer-bottom"><span>Enter to send · Shift + Enter for a new line</span><button aria-label="Send message" disabled={!input.trim()||generating}><Send size={17}/></button></div></form><small>{generating?"Copilot is thinking…":"AI can make mistakes. Review generated code before using it."}</small></div></div></div></section>
  : page==="Vision Center" ? <section className="stack">{heading(page,"Prepare image input for future computer-vision features.","NOT CONNECTED")}<div className="panel"><Camera size={30}/><h3>Image input</h3><p>Choose a picture from your phone to preview it here. This prototype does not send images to an AI model.</p><label className="button">Choose image<input hidden type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f){setImage(URL.createObjectURL(f));setNotice("Local preview only. AI analysis is not connected.")}}}/></label>{image&&<img className="preview" src={image} alt="Selected preview"/>}{notice&&<p className="notice">{notice}</p>}</div>{card(<ShieldCheck/>,"Planned vision capabilities","Object recognition, camera integration, visual Q&A and privacy controls.")}</section>
  : page==="Voice Center" ? <section className="voice-session-screen" aria-label="NEXORA AI voice session"><div className="voice-top-notch" aria-hidden="true"/><header className="voice-selection-header"><h1>NEXORA Voice</h1><button type="button" className="voice-confirm" onClick={()=>setPage("Overview")} aria-label="Leave Voice Center"><Check size={24} strokeWidth={1.8}/></button></header><div className={`voice-orb-stage ${voiceMode?"is-listening":""} ${voiceStatus.toLowerCase().includes("speaking")?"is-speaking":""} ${voiceStatus.toLowerCase().includes("processing")?"is-thinking":""}`} role="img" aria-label="Animated cosmic glass orb"><div className="cosmic-orb"><div className="orb-nebula"/><div className="orb-light-ribbons"/><div className="orb-starfield">{Array.from({length:38},(_,index)=><i key={index} style={{"--x":`${(index*37+11)%92+4}%`,"--y":`${(index*53+7)%90+5}%`,"--size":`${index%5===0?2.4:index%3===0?1.7:1.1}px`,"--delay":`${(index%9)*-.37}s`,"--twinkle":`${1.8+(index%5)*.45}s`}}/> )}</div><div className="orb-glass-shine"/></div></div><div className="voice-controls"><p className="voice-session-status" role="status" aria-live="polite">{voiceStatus}{voiceTranscript?` · ${voiceTranscript}`:""}</p>{voiceMode?<button type="button" className="voice-action-button voice-stop-button" onClick={stopVoiceMode}><X size={19}/> Stop voice conversation</button>:<button type="button" className="voice-action-button" onClick={startVoiceMode}><Mic size={19}/> Start voice conversation</button>}<p className="voice-privacy-note">Your microphone stays off until you start a conversation. You can stop at any time.</p></div></section>
  : page==="Memory" ? <section className="stack">{heading("Project Memory","Notes are stored in this browser on this device.")}<div className="toolbar"><span>{memory.length} saved notes</span><button onClick={addMemory}>+ Add memory</button></div>{memory.map((m,i)=><div className="memory" key={i}><Database/><p>{m}</p><button className="delete" onClick={()=>setMemory(a=>a.filter((_,n)=>n!==i))}>Delete</button></div>)}<p className="notice">Notes are stored locally. They are not synced to a server or shared across devices.</p></section>
  : page==="Learning" ? <section className="stack">{heading("Learning Lab","Plan skills and training experiments for NEXORA AI.","PLANNING")}<div className="grid two">{card(<Sparkles/>,"Demonstration learning","Record human demonstrations and turn them into reviewed task examples.")}{card(<Activity/>,"Feedback & evaluation","Track outcomes in simulation and compare test runs.")}{card(<BrainCircuit/>,"Skill library","Store versioned, reviewed skills with clear permissions.")}{card(<ShieldCheck/>,"Safe testing","Require simulation, supervised trials and an emergency stop.","Required")}</div></section>
  : page==="Robotics" ? <section className="stack robotics-page">{heading("Robotics Center","Universal hardware integration · vendor-neutral adapter architecture.","MULTI-TRANSPORT HUB")}<div className="robotics-status"><div className="robotics-status-icon"><Bot size={27}/></div><div><b>NEXORA Integrated Robotics Bridge</b><p>The connection manager lives inside ATLAS. It is designed to connect to compatible robots, vehicles, sensors and industrial equipment across Bluetooth, Wi-Fi, USB, Ethernet, CAN adapters and network protocols. Each transport is shown with its real implementation status; a planned adapter is not presented as a working connection.</p></div><span className="badge">SIMULATION READY</span></div><div className="robotics-section-head"><div><h2>UNIVERSAL CONNECTION HUB</h2><p>One connection manager for phone radios, wired adapters, vehicle buses, industrial networks and robotics middleware.</p></div><span className="badge">{roboticsTransportCatalog.length} TRANSPORTS</span></div><div className="robotics-transport-grid">{roboticsTransportCatalog.map(item=><article className="card robotics-adapter" key={item.id}><div className="cardtop"><span className="cardicon"><Radio size={18}/></span><span className={"badge transport-state "+item.state}>{item.state==="available"?"Available":item.state==="implemented"?"Implemented":"Planned"}</span></div><h3>{item.name}</h3><small className="transport-group">{item.group}</small><p>{item.scope}</p><div className="transport-route">Connection path: {item.route}</div></article>)}</div><div className="robot-discovery-panel"><div className="robot-discovery-copy"><b>LIVE BLUETOOTH LE DISCOVERY</b><p>{robotDiscoveryCapability.reason}</p><small>{robotBluetoothDevice?`${robotBluetoothDevice.name} · ${robotBluetoothDevice.connection}`:robotDiscoveredDevices.length?`${robotDiscoveredDevices.length} nearby device(s) discovered`:"No device selected"}</small><small className="robot-discovery-feedback">{robotDiscoveryMessage}</small>{robotDiscoveredDevices.length>0&&<ul className="robot-discovered-list">{robotDiscoveredDevices.map(device=><li key={device.id}><b>{device.name}</b><span>{device.transport} · {device.rssi===null||device.rssi===undefined?"signal unavailable":`${device.rssi} dBm`} · {device.connection}</span><button type="button" className="secondary" disabled={robotSensorBusy||(device.connected&&robotSensorReadings.length>0)} onClick={()=>connectRobotSensorDevice(device)}>{device.connected&&robotSensorReadings.length>0?"Connected":"Connect & read sensors"}</button></li>)}</ul>}{robotSensorReadings.length>0&&<div className="robot-sensor-readings"><b>READ-ONLY BLE SENSOR READINGS</b>{robotSensorReadings.map(reading=><div className="robot-sensor-reading" key={reading.sensorId}><span>{reading.sensorId}</span><strong>{reading.value} {reading.unit}</strong><small>{new Date(reading.timestamp).toLocaleTimeString()}</small></div>)}</div>}</div><div className="robot-discovery-actions"><span className="badge">{robotBluetoothDevice?.connected?"CONNECTED":robotDiscoveryCapability.supported?"READY TO SCAN":"API UNAVAILABLE"}</span><button onClick={startRobotDiscovery} disabled={!robotDiscoveryCapability.supported||robotDiscoveryBusy}>{robotDiscoveryBusy?"Searching…":"Discover Bluetooth devices"}</button>{robotBluetoothDevice&&<button className="secondary" onClick={disconnectRobotDevice}>Disconnect</button>}</div></div><div className="robotics-section-head"><div><h2>INTEGRATION LAYERS</h2><p>Discovery and telemetry first; actuation remains locked out.</p></div></div><div className="grid two">{card(<Activity/>,"Device discovery",robotBluetoothDevice?`Selected ${robotBluetoothDevice.name}; ${robotBluetoothDevice.connection}.`:"Live Bluetooth discovery is available when this browser exposes Web Bluetooth. USB, Wi-Fi and native Android adapters remain pending.",robotBluetoothDevice?.connected?"Connected":robotDiscoveryCapability.supported?"Ready":"Unavailable")}{card(<Database/>,"Sensor telemetry","Read-only, timestamped and unit-labelled sensor data with stale-data detection.","Not connected")}{card(<ShieldCheck/>,"Safety supervisor","Independent hardware emergency stop, watchdog, interlocks and operator authorization.","Required")}{card(<BrainCircuit/>,"Simulation first","Validate adapter contracts and sensor streams against mock devices before hardware trials.","Planned")}</div><div className="robotics-section-head"><div><h2>MOTION LAB · SIMULATION</h2><p>Motion is enabled in the virtual robot simulator. This does not move connected physical hardware.</p></div><span className="badge">SIMULATION ACTIVE</span></div><div className="robot-motion-lab"><div className="robot-motion-stage"><div className="robot-motion-track"><div className="robot-motion-unit" style={{left:`calc(${robotSimPosition}% - 24px)`}}><Bot size={28}/></div></div><div className="robot-motion-scale"><span>0%</span><span>Virtual travel</span><span>100%</span></div><div className="robot-motion-readout"><span>POSITION <b>{robotSimPosition.toFixed(0)}%</b></span><span>SIMULATED SPEED <b>{robotSimSpeed}%</b></span><span>STATE <b>{robotSimRunning?"MOVING":"PAUSED"}</b></span></div></div><div className="robot-motion-controls"><label htmlFor="robot-sim-speed">Simulation speed</label><input id="robot-sim-speed" type="range" min="5" max="100" value={robotSimSpeed} onChange={event=>setRobotSimSpeed(Number(event.target.value))}/><div className="robot-motion-buttons"><button onClick={()=>setRobotSimRunning(value=>!value)}>{robotSimRunning?"Pause motion":"Start motion"}</button><button className="secondary" onClick={()=>{setRobotSimRunning(false);setRobotSimPosition(0);setRobotSimDirection(1);}}>Reset simulation</button></div></div></div><div className="safety"><ShieldCheck/><div><b>Physical hardware motion remains locked</b><p>Only virtual motion is enabled here. ATLAS does not send motor, actuator, servo or gripper commands to real equipment. Physical motion requires a separately reviewed safety design, independent emergency stop and verified hardware safeguards.</p></div></div><p className="notice">Plugin architecture specification: <code>docs/ROBOTICS_PLUGIN_ARCHITECTURE.md</code>. No robot is paired. Bluetooth discovery uses the browser device picker where supported. Native Android BLE scanning is integrated in the APK. USB OTG, Wi-Fi peer discovery and sensor-specific read-only adapters remain pending. No control or movement commands are sent.</p></section>
  : <section className="stack">{heading("Settings","Prototype configuration and system information.")}<div className="panel settings">{[["Application","NEXORA AI · NEXORA TECHNOLOGIES"],["Architecture","Hybrid cloud + edge (planned)"],["AI engine","Cloudflare Workers AI · Llama 3.3 + fallbacks"],["Memory storage","This device / browser"],["Robot connection","Integrated bridge · hardware adapters planned"],["Motion mode","Simulation enabled · physical actuation locked"]].map(([a,b])=><div className="setting" key={a}><span>{a}</span><b>{b}</b></div>)}</div><p className="notice">Never paste API keys or passwords into chat messages or public code. Store model-provider credentials only in private server-side environment variables.</p></section>;
  return <div className={page==="Voice Center"?"app voice-session-active":"app"}><aside className={menu?"sidebar open":"sidebar"}><div className="brand"><AtlasLogo className="logo-brand"/><div><b>NEXORA<span>AI</span></b><small>PHYSICAL INTELLIGENCE</small></div><button className="x" onClick={()=>setMenu(false)}><X/></button></div><label>WORKSPACE</label><nav>{nav.map(([n,I])=><button className={page===n?"active":""} key={n} onClick={()=>{setPage(n);setMenu(false)}}><I size={18}/>{n}</button>)}</nav><div className="sidefoot"><b>● Cloud AI gateway</b><p>General chat uses NVIDIA when configured, with Cloudflare Workers AI fallbacks. Otherwise Cloudflare Workers AI is primary. Local memory remains on this device.</p><small>NEXORA BUILD 0.5.0 · CLOUD MODEL</small></div></aside><main><header className="top"><button className="hamb" onClick={()=>setMenu(true)}><Menu/></button><span>NEXORA AI　›　<b>{page}</b></span></header><div className="content">{content}</div></main>{menu&&<button className="scrim" onClick={()=>setMenu(false)} aria-label="Close navigation"/>}</div>;
}

export default function App() {
  return <AtlasWorkspace />;
}
