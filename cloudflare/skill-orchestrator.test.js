import test from "node:test";
import assert from "node:assert/strict";
import { buildSkillContext, getSkillCatalogStats, getSpecialists, routeSkills } from "./skill-orchestrator.js";

const sample = [
  { id: "cuopt", name: "cuOpt Numerical Optimization", description: "GPU accelerated linear programming and mixed integer optimization", tags: ["nvidia", "cuda", "milp"], instructions: "Use LP or MILP correctly." },
  { id: "vision", name: "Vision AI", description: "Build computer vision applications", tags: ["vision", "image"], instructions: "Use vision models." },
];

const disciplineCases = [
  ["Design a mechanical gearbox and select bearings", "mechanical-cad"],
  ["Calculate a reinforced concrete bridge", "civil-structural"],
  ["Design an electrical circuit and PCB", "electrical-electronics"],
  ["Analyze aircraft wing aerodynamics", "aerospace-flight"],
  ["Size a chemical reactor for a process plant", "chemical-process"],
  ["Compare alloy materials and fracture properties", "materials-science"],
  ["Plan inverse kinematics for a robot arm", "robotics-mechatronics"],
  ["Model an electric vehicle powertrain", "automotive-mobility"],
  ["Design a heat exchanger for renewable energy", "energy-thermal"],
  ["Run computational fluid dynamics for pipe flow", "fluid-process"],
  ["Design a biomedical medical device biosensor", "biomedical"],
  ["Debug a Python API and database application", "software-computer"],
];

test("routes all twelve engineering disciplines to their dedicated specialists", () => {
  for (const [prompt, expectedId] of disciplineCases) {
    const routed = routeSkills(prompt, []);
    assert.deepEqual(routed.specialists.map((item) => item.id), [expectedId], prompt);
  }
});

test("routes a mechanical gearbox prompt to Mechanical & CAD, not AI & ML", () => {
  const routed = routeSkills("Help me design a mechanical gearbox", []);
  assert.equal(routed.specialists[0].id, "mechanical-cad");
  assert.equal(routed.specialists.length, 1);
});

test("supports relevant cross-discipline routing without returning every specialist", () => {
  const routed = routeSkills("Design an electric vehicle battery thermal management system", []);
  assert.ok(routed.specialists.some((item) => item.id === "automotive-mobility"));
  assert.ok(routed.specialists.some((item) => item.id === "energy-thermal"));
  assert.ok(routed.specialists.length <= 3);
});

test("does not route generic conversation to an engineering specialist", () => {
  const routed = routeSkills("Hello, tell me a joke about the weather", []);
  assert.equal(routed.specialists.length, 0);
});

test("routes numerical optimization prompts to cuOpt and optimization skill references", () => {
  const routed = routeSkills("Use NVIDIA cuOpt for mixed integer optimization", sample);
  assert.equal(routed.skills[0].id, "cuopt");
  assert.equal(routed.specialists.length, 0);
});

test("routes vision prompts to the relevant skill without inventing an engineering discipline", () => {
  const routed = routeSkills("Build a computer vision image application", sample);
  assert.equal(routed.skills[0].id, "vision");
  assert.equal(routed.specialists.length, 0);
});

test("does not inject unrelated skill content", () => {
  const result = buildSkillContext("Write a poem", sample);
  assert.equal(result.context, "");
  assert.equal(result.skills.length, 0);
});

test("catalog statistics report the installed catalog and twelve disciplines", () => {
  assert.equal(getSkillCatalogStats(sample).skillCount, 2);
  assert.equal(getSkillCatalogStats(sample).specialistCount, 12);
  assert.equal(getSpecialists().length, 12);
  assert.deepEqual(getSpecialists().map((item) => item.id), [
    "mechanical-cad", "civil-structural", "electrical-electronics", "aerospace-flight",
    "chemical-process", "materials-science", "robotics-mechatronics", "automotive-mobility",
    "energy-thermal", "fluid-process", "biomedical", "software-computer",
  ]);
});
