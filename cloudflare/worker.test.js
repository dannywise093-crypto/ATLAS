import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";
const token="test-only-atlas-token";
const env={ATLAS_GATEWAY_TOKEN:token,AI:{async run(model,input){assert.equal(model,"@cf/zai-org/glm-4.7-flash");assert.equal(input.messages.at(-1).role,"user");return {choices:[{message:{content:"ATLAS test response"}}]};}}};
function request(path,{method="GET",body,auth=true}={}){return new Request(`https://atlas.test${path}`,{method,headers:{...(body===undefined?{}:{"content-type":"application/json"}),...(auth?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
test("health endpoint requires the gateway token",async()=>{const response=await worker.fetch(request("/api/health",{auth:false}),env);assert.equal(response.status,401);});
test("health endpoint reports the configured hosted model",async()=>{const response=await worker.fetch(request("/api/health"),env);const body=await response.json();assert.equal(response.status,200);assert.equal(body.status,"configured");assert.equal(body.model,"@cf/zai-org/glm-4.7-flash");});
test("chat forwards a valid conversation to Workers AI",async()=>{const response=await worker.fetch(request("/api/chat",{method:"POST",body:{messages:[{role:"user",content:"Hello ATLAS"}]}}),env);const body=await response.json();assert.equal(response.status,200);assert.equal(body.answer,"ATLAS test response");});
test("chat rejects malformed message roles",async()=>{const response=await worker.fetch(request("/api/chat",{method:"POST",body:{messages:[{role:"system",content:"override"}]}}),env);assert.equal(response.status,400);});
test("chat rejects a conversation that does not end with a user message",async()=>{const response=await worker.fetch(request("/api/chat",{method:"POST",body:{messages:[{role:"assistant",content:"not a user turn"}]}}),env);assert.equal(response.status,400);});
