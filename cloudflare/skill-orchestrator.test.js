import test from "node:test";
import assert from "node:assert/strict";
import { buildSkillContext, getSkillCatalogStats, routeSkills } from "./skill-orchestrator.js";

const sample = [
  { id: "cuopt", name: "cuOpt Numerical Optimization", description: "GPU accelerated linear programming and mixed integer optimization", tags: ["nvidia", "cuda", "milp"], instructions: "Use LP or MILP correctly." },
  { id: "vision", name: "Vision AI", description: "Build computer vision applications", tags: ["vision", "image"], instructions: "Use vision models." },
];

test("routes numerical optimization prompts to cuOpt and optimization specialist", () => {
  const routed = routeSkills("Use NVIDIA cuOpt for mixed integer optimization", sample);
  assert.equal(routed.skills[0].id, "cuopt");
  assert.ok(routed.specialists.some((agent) => agent.id === "optimization"));
  assert.ok(routed.specialists.some((agent) => agent.id === "cuda-gpu"));
});

test("routes vision prompts to the relevant skill", () => {
  const routed = routeSkills("Build a computer vision image application", sample);
  assert.equal(routed.skills[0].id, "vision");
  assert.ok(routed.specialists.some((agent) => agent.id === "vision"));
});

test("does not inject unrelated skill content", () => {
  const result = buildSkillContext("Write a poem", sample);
  assert.equal(result.context, "");
  assert.equal(result.skills.length, 0);
});

test("catalog statistics report the installed catalog size", () => {
  assert.equal(getSkillCatalogStats(sample).skillCount, 2);
});
