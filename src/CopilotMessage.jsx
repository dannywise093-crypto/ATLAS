import React, { useState } from "react";
import { Check, Copy, Play, Square } from "lucide-react";

function splitMessage(text) {
  const parts = [];
  const pattern = /\x60\x60\x60([a-zA-Z0-9_+.-]*)\n([\s\S]*?)\x60\x60\x60/g;
  let cursor = 0, match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ type: "text", value: text.slice(cursor, match.index) });
    parts.push({ type: "code", language: (match[1] || "text").toLowerCase(), value: match[2].replace(/\n$/, "") });
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });
  return parts.length ? parts : [{ type: "text", value: text }];
}

function createPythonWorker() {
  const source = [
    'import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs";',
    'let runtime;',
    'self.onmessage = async (event) => {',
    '  try {',
    '    runtime ||= await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/" });',
    '    runtime.globals.set("__nexora_code", String(event.data?.code || ""));',
    '    const output = await runtime.runPythonAsync(' + JSON.stringify('import sys, io, traceback\n__out=io.StringIO()\n__err=io.StringIO()\n__oldout,__olderr=sys.stdout,sys.stderr\nsys.stdout,sys.stderr=__out,__err\ntry:\n exec(compile(__nexora_code,"<nexora-copilot>","exec"),{"__name__":"__main__"})\nexcept BaseException:\n traceback.print_exc(file=__err)\nfinally:\n sys.stdout,sys.stderr=__oldout,__olderr\n("__NEXORA_ERROR__\\n" if __err.getvalue() else "")+__out.getvalue()+__err.getvalue()') + ');',
    '    self.postMessage({ ok: true, output: String(output || "(Code finished without printed output.)") });',
    '  } catch (error) { self.postMessage({ ok: false, output: String(error?.message || error) }); }',
    '};'
  ].join("\n");
  return new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })), { type: "module" });
}

function PythonRunner({ code }) {
  const [status, setStatus] = useState("idle"), [output, setOutput] = useState(""), [copied, setCopied] = useState(false), [worker, setWorker] = useState(null);
  async function copyCode() {
    try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
    catch { setOutput("Clipboard access unavailable. Select and copy the code manually."); }
  }
  function stopRun() { if (worker?.__timeoutId) window.clearTimeout(worker.__timeoutId); worker?.terminate(); setWorker(null); setStatus("stopped"); setOutput("Execution stopped by the user."); }
  function runCode() {
    if (status === "running") return;
    setStatus("running"); setOutput("Starting Python… The first run downloads the Pyodide runtime.");
    let active;
    try { active = createPythonWorker(); setWorker(active); }
    catch (error) { setStatus("error"); setOutput("Could not start Python worker: " + error.message); return; }
    const timer = window.setTimeout(() => { active.terminate(); setWorker(null); setStatus("timeout"); setOutput("Stopped after 45 seconds to protect this device."); }, 45000);
    active.__timeoutId = timer;
    active.onmessage = event => {
      window.clearTimeout(timer); active.terminate(); setWorker(null);
      const raw = String(event.data?.output || "");
      setOutput(raw.slice(0, 12000) + (raw.length > 12000 ? "\n… output truncated at 12,000 characters." : ""));
      setStatus(event.data?.ok ? "complete" : "error");
    };
    active.onerror = event => { window.clearTimeout(timer); active.terminate(); setWorker(null); setStatus("error"); setOutput("Python worker failed: " + (event.message || "Unknown error.")); };
    active.postMessage({ code });
  }
  return <div className="copilot-code-actions">
    <div className="copilot-action-row">
      <button type="button" onClick={copyCode} className="copilot-code-button"><Copy size={14}/>{copied ? "Copied" : "Copy code"}</button>
      {status === "running" ? <button type="button" onClick={stopRun} className="copilot-code-button danger"><Square size={13}/>Stop</button> : <button type="button" onClick={runCode} className="copilot-code-button run"><Play size={14}/>Run Python</button>}
    </div>
    {status !== "idle" && <section className={"copilot-run-output " + status} aria-live="polite">
      <div className="copilot-output-heading"><span>{status === "running" ? "EXECUTING IN BROWSER" : status === "complete" ? "REAL EXECUTION OUTPUT" : "EXECUTION STATUS"}</span>{status === "complete" && <Check size={14}/>}</div>
      <pre>{output}</pre>
    </section>}
    <small className="copilot-runtime-note">Runs locally in a browser Web Worker using Pyodide. No server shell or server credentials are exposed. Available packages depend on the runtime.</small>
  </div>;
}

export default function CopilotMessage({ text }) {
  return <div className="copilot-rich-message">{splitMessage(String(text || "")).map((part, index) =>
    part.type === "code" ? <section className="copilot-code-card" key={index}>
      <header><span>{part.language.toUpperCase()}</span><span>COMPLETE SOURCE</span></header>
      <pre><code>{part.value}</code></pre>
      {["python","py"].includes(part.language) ? <PythonRunner code={part.value}/> : <div className="copilot-code-unsupported">Copy this source into your {part.language} environment. In-browser execution currently supports Python.</div>}
    </section> : <p className="copilot-message-text" key={index}>{part.value}</p>
  )}</div>;
}