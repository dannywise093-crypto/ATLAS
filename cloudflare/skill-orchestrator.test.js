import test from "node:test";
import assert from "node:assert/strict";
import { buildSkillContext, getSkillCatalogStats, routeSkills } from "./skill-orchestrator.js";

const sample = [
  { id: "cuopt", name: "cuOpt Numerical Optimization", description: "GPU accelerated linear programming and mixed integer optimization", tags: ["nvidia", "cuda", "milp"], instructions: "Use LP or MILP correctly." },
  { id: "vision", name: "Vision AI", description: "Build computer vision applications", tags: ["vision", "image"], instructions: "Use vision models." },
  { id: "cuda-memory", name: "CUDA Memory Optimization", description: "Optimize CUDA kernel memory coalescing and shared memory access", tags: ["cuda", "gpu", "memory"], instructions: "Coalesce memory access." },
  { id: "isaac-robotics", name: "Isaac Sim Robotics", description: "Robot simulation and digital twin workflows", tags: ["robotics", "isaac sim", "simulation"], instructions: "Build a robot simulation." },
  { id: "cuda-sanitizer", name: "CUDA Compute Sanitizer", description: "Diagnose memory errors in CUDA applications", tags: ["cuda", "debugging"], instructions: "Diagnose CUDA errors." },
];

test("routes numerical optimization prompts to cuOpt and optimization specialist", () => {
  const routed = routeSkills("Use NVIDIA cuOpt for mixed integer optimization", sample);
  assert.equal(routed.skills[0].id, "cuopt");
  assert.ok(routed.specialists.some((agent) => agent.id === "optimization"));
  assert.equal(routed.specialists.some((agent) => agent.id === "cuda-gpu"), false);
});

test("routes vision prompts to the relevant skill", () => {
  const routed = routeSkills("Build a computer vision image application", sample);
  assert.equal(routed.skills[0].id, "vision");
  assert.ok(routed.specialists.some((agent) => agent.id === "vision"));
});

test("does not confuse substrings with specialist terms", () => {
  const routed = routeSkills("Explain how this system works", sample);
  assert.equal(routed.skills.length, 0);
  assert.equal(routed.specialists.some((agent) => agent.id === "ai-ml"), false);
});

test("CUDA memory questions rank the CUDA memory skill above generic CUDA diagnostics", () => {
  const routed = routeSkills("Explain CUDA kernel memory coalescing and shared memory", sample);
  assert.equal(routed.skills[0].id, "cuda-memory");
  assert.equal(routed.skills.some((skill) => skill.id === "cuopt"), false);
  assert.ok(routed.specialists.some((agent) => agent.id === "cuda-gpu"));
  assert.equal(routed.specialists.some((agent) => agent.id === "ai-ml"), false);
});

test("Isaac Sim robotics selects robotics without incorrectly selecting CUDA", () => {
  const routed = routeSkills("Build a robot simulation with NVIDIA Isaac Sim and a digital twin", sample);
  assert.equal(routed.skills[0].id, "isaac-robotics");
  assert.equal(routed.skills.some((skill) => skill.id === "cuopt"), false);
  assert.ok(routed.specialists.some((agent) => agent.id === "robotics-simulation"));
  assert.equal(routed.specialists.some((agent) => agent.id === "cuda-gpu"), false);
});

test("does not inject unrelated skill content", () => {
  const result = buildSkillContext("Write a poem", sample);
  assert.equal(result.context, "");
  assert.equal(result.skills.length, 0);
});

test("catalog statistics report the installed catalog size", () => {
  assert.equal(getSkillCatalogStats(sample).skillCount, 5);
  assert.equal(getSkillCatalogStats(sample).maxSkillsPerRequest, 4);
  assert.equal(getSkillCatalogStats(sample).specialistCount, 6);
});
