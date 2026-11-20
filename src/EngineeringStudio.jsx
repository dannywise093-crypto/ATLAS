import React, { useMemo, useRef, useState } from "react";
import { generateAtlasResponse } from "./modelRuntime.js";
import { Download, Image as ImageIcon, Search, Settings2, Wrench } from "lucide-react";

const SYSTEM_GUIDE = `You are NEXORA ENGINEERING, an engineering research and concept-development assistant.
Treat the user's request as a real engineering project, not an image-only prompt.
For every response: (1) clarify the design objective and requirements, (2) research current relevant engineering knowledge and cite actual source URLs supplied by live retrieval when available, (3) distinguish verified facts, estimates, assumptions and proposed concepts, (4) provide a coherent architecture and subsystem breakdown, (5) show equations and units for calculations and state missing inputs, (6) describe materials, manufacturing routes, tolerances and validation plans at an educational conceptual level, (7) identify failure modes, hazards, regulations and required qualified professional review.
Never invent test results, standards compliance, source citations, precise dimensions or validated performance. Do not present an unverified concept as production-ready. For vehicle propulsion and other safety-critical systems, provide design reasoning and safe validation planning; do not provide instructions that bypass safety controls, emissions rules or roadworthiness requirements.
Format output with these headings: PROJECT BRIEF; RESEARCH & SOURCES; PROPOSED ARCHITECTURE; ENGINEERING CALCULATIONS; MATERIALS & MANUFACTURING; VALIDATION & SAFETY; NEXT DESIGN ITERATION.`;

function downloadFile(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function EngineeringStudio() {
  const [idea, setIdea] = useState("");
  const [discipline, setDiscipline] = useState("Automotive / Mechanical");
  const [constraints, setConstraints] = useState("");
  const [busy, setBusy] = useState(false);
  const designControllerRef = useRef(null);
  const [visualBusy, setVisualBusy] = useState(false);
  const [report, setReport] = useState("");
  const [visual, setVisual] = useState("");
  const [error, setError] = useState("");
  const [visualError, setVisualError] = useState("");
  const [stage, setStage] = useState("Ready for a new engineering project.");
  const prompt = useMemo(() => [
    SYSTEM_GUIDE,
    "DISCIPLINE: " + discipline,
    "PROJECT IDEA: " + idea.trim(),
    "USER CONSTRAINTS: " + (constraints.trim() || "Not yet specified; state assumptions and ask for the most important missing inputs."),
    "Research the topic with live sources if available. Develop a traceable first-pass concept package, not a claim of a completed or validated design. If a requirement is missing, use clearly marked provisional assumptions."
  ].join("\n\n"), [idea, discipline, constraints]);

  async function createDesign(event) {
    event.preventDefault();
    if (!idea.trim() || busy) return;
    const controller = new AbortController();
    designControllerRef.current = controller;
    setBusy(true); setError(""); setReport(""); setVisual("");
    const startedAt = Date.now();
    setStage("Preparing the engineering brief…");
    const progressTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setStage("NEXORA is researching and drafting the concept package… " + elapsed + "s elapsed.");
    }, 5000);
    const deadlineTimer = setTimeout(() => controller.abort(), 75000);
    try {
      const answer = await generateAtlasResponse([{ role: "user", text: prompt }], controller.signal);
      if (controller.signal.aborted) return;
      setReport(answer);
      setStage("Concept package generated. Review assumptions and source references.");
    } catch (err) {
      const message = controller.signal.aborted || err?.name === "AbortError"
        ? "This request exceeded the 75-second limit. Try a shorter project brief or submit it again."
        : (err?.message || "NEXORA could not complete the engineering request.");
      setError(message);
      setStage("The design request could not be completed.");
    } finally {
      clearInterval(progressTimer);
      clearTimeout(deadlineTimer);
      if (designControllerRef.current === controller) designControllerRef.current = null;
      setBusy(false);
    }
  }

  function cancelDesign() {
    designControllerRef.current?.abort();
    setStage("Cancelling the engineering request…");
  }

  async function saveVisual() {
    if (!visual) return;
    try {
      const response = await fetch(visual);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "nexora-engineering-concept.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setVisualError("Could not save the generated image.");
    }
  }

  async function generateVisual() {
    if (!idea.trim() || visualBusy) return;
    setVisualBusy(true); setVisualError("");
    try {
      // The Pages Function currently accepts prompts up to 1,800 characters.
      // Keep the composed prompt below that limit even when the user enters a long brief.
      const visualPrompt = "Create a high-quality industrial design concept render: " + idea.trim().slice(0, 950) +
        ". Discipline: " + discipline + ". Constraints: " + (constraints.trim().slice(0, 300) || "Use plausible conceptual proportions.") +
        ". Clean studio product visualization, realistic materials, neutral background, three-quarter view. Concept illustration only, not a manufacturing drawing. No text, labels, logos, watermark, people, or brand imitation.";
      const response = await fetch("/api/engineering/visual", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: visualPrompt })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "The image-generation service is unavailable.");
      }
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("The visual service returned an unsupported image format.");
      setVisual(URL.createObjectURL(blob));
    } catch (err) { setVisualError(err?.message || "Could not generate the concept image."); }
    finally { setVisualBusy(false); }
  }

  return <section className="engineering-studio stack">
    <div className="engineering-hero">
      <div className="engineering-eyebrow">NEXORA ENGINEERING · DESIGN WORKBENCH</div>
      <h1>From engineering idea to design package.</h1>
      <p>Research the problem, develop a concept, calculate key parameters, visualize the design and export a reviewable project brief.</p>
      <div className="engineering-steps"><span>01 · Research</span><span>02 · Design</span><span>03 · Visualize</span><span>04 · Validate</span></div>
    </div>
    <div className="engineering-grid">
      <article className="card engineering-input">
        <div className="cardtop"><span className="cardicon"><Wrench/></span><span className="badge">PROJECT INPUT</span></div>
        <form className="stack" onSubmit={createDesign}>
          <label htmlFor="eng-discipline">Engineering discipline</label>
          <select id="eng-discipline" value={discipline} onChange={e=>setDiscipline(e.target.value)}>
            <option>Automotive / Mechanical</option><option>Civil / Structural</option><option>Electrical / Electronics</option>
            <option>Aerospace / Flight</option><option>Robotics / Mechatronics</option><option>Energy / Thermal</option>
            <option>Materials Science</option><option>Chemical / Process</option><option>Biomedical</option><option>Software / Computer</option>
          </select>
          <label htmlFor="eng-idea">What do you want to engineer?</label>
          <textarea id="eng-idea" rows="5" maxLength="6000" value={idea} onChange={e=>setIdea(e.target.value)} placeholder="Example: Research and develop an original high-performance hybrid supercar powertrain and exterior body concept. Include subsystem architecture, materials, calculations, manufacturing considerations and a validation plan." required/>
          <label htmlFor="eng-constraints">Requirements and constraints (optional)</label>
          <textarea id="eng-constraints" rows="3" maxLength="3000" value={constraints} onChange={e=>setConstraints(e.target.value)} placeholder="Target use, size envelope, budget range, materials, power source, operating environment, regulations…"/>
          <div className="engineering-submit-actions"><button type="submit" disabled={!idea.trim()||busy}>{busy?"Developing engineering package…":"Research & develop concept"}</button>{busy&&<button type="button" className="secondary" onClick={cancelDesign}>Cancel</button>}</div>
        </form>
        <p className="engineering-stage" aria-live="polite"><span className="engineering-dot"/>{stage}</p>
        {error&&<p role="alert" className="engineering-error">{error}</p>}
      </article>
      <article className="card engineering-visual-card">
        <div className="cardtop"><span className="cardicon"><ImageIcon/></span><span className="badge">CONCEPT VISUALIZER</span><button type="button" className="secondary" disabled={!idea.trim()||visualBusy} onClick={generateVisual}>{visualBusy?"Generating…":"Generate image"}</button></div>
        <p>Generate an AI concept illustration based on your engineering brief. It is a visual reference, not dimensionally accurate CAD.</p>
        {visualError&&<p role="alert" className="engineering-error">{visualError}</p>}
        {visual&&<div className="engineering-visual"><img src={visual} alt="AI-generated engineering concept illustration"/><button type="button" className="secondary" onClick={saveVisual}>Save image</button></div>}
        {!visual&&<div className="engineering-visual-placeholder"><ImageIcon size={32}/><span>Your concept image will appear here.</span></div>}
      </article>
    </div>
    {report&&<article className="card engineering-report">
      <div className="cardtop"><span className="cardicon"><Search/></span><span className="badge">ENGINEERING REPORT</span></div>
      <div className="engineering-report-text">{report}</div>
      <div className="engineering-actions">
        <button type="button" onClick={()=>downloadFile("nexora-engineering-design-report.md",report,"text/markdown")}><Download size={16}/> Export report</button>
        <button type="button" className="secondary" onClick={()=>navigator.clipboard?.writeText(report)}>Copy report</button>
      </div>
      <div className="engineering-disclaimer"><Settings2 size={18}/><span>Concept-stage output only. Verify calculations, source material, applicable codes and all safety-critical designs with qualified engineers and appropriate physical testing before manufacturing or operation.</span></div>
    </article>}
  </section>;
}
