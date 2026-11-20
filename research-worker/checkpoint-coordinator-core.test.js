import test from "node:test";
import assert from "node:assert/strict";
import { CheckpointCoordinatorCore, CheckpointLeaseError } from "./checkpoint-coordinator-core.js";

function setup() {
  let state = { scope:null, lastFencingToken:0, lease:null };
  let now = 10_000;
  let nextLease = 0;
  const published = [];
  const claimed = [];
  const index = {
    async claimThread(input) {
      claimed.push(input);
      if (index.failClaim) throw new Error("D1 unavailable");
    },
    async putCheckpoint(input) {
      published.push(input);
      return { checkpointId:input.checkpointId, revision:input.expectedRevision + 1 };
    },
    failClaim:false,
  };
  const core = new CheckpointCoordinatorCore({
    loadState:async()=>structuredClone(state),
    saveState:async(value)=>{state=structuredClone(value);},
    checkpointIndex:index,
    now:()=>now,
    makeLeaseId:()=> "lease-" + (++nextLease),
  });
  const scope = {tenantId:"acme",threadId:"thread-1",checkpointNs:""};
  return {core,index,published,claimed,scope,setNow:(v)=>{now=v;},getState:()=>structuredClone(state)};
}

test("acquire issues monotonic fencing tokens and prevents competing live leases", async () => {
  const x=setup();
  const first=await x.core.acquire({...x.scope,holderId:"runner-a",ttlMs:10_000});
  assert.equal(first.fencingToken,1);
  assert.equal(first.reused,false);
  await assert.rejects(x.core.acquire({...x.scope,holderId:"runner-b"}),
    (error)=>error instanceof CheckpointLeaseError && error.code==="lease_busy");
  const renewed=await x.core.acquire({...x.scope,holderId:"runner-a",ttlMs:20_000});
  assert.equal(renewed.leaseId,first.leaseId);
  assert.equal(renewed.fencingToken,1);
  assert.equal(renewed.reused,true);
  assert.equal(x.claimed.length,1);
});

test("expired lease takeover increments fencing token and invalidates the previous holder", async () => {
  const x=setup();
  const oldLease=await x.core.acquire({...x.scope,holderId:"runner-a",ttlMs:5_000});
  x.setNow(15_001);
  const newLease=await x.core.acquire({...x.scope,holderId:"runner-b",ttlMs:5_000});
  assert.equal(newLease.fencingToken,2);
  await assert.rejects(x.core.renew({...x.scope,holderId:"runner-a",...oldLease}),
    (error)=>error.code==="lease_lost");
});

test("publish is serialized under the active lease and coordinator scope overrides payload scope", async () => {
  const x=setup();
  const lease=await x.core.acquire({...x.scope,holderId:"runner-a"});
  const result=await x.core.publish({
    ...x.scope, holderId:"runner-a", ...lease,
    checkpoint:{
      tenantId:"attacker",threadId:"other",checkpointNs:"wrong",
      checkpointId:"cp-1",expectedRevision:0,parentCheckpointId:null,
      checkpoint:{type:"msgpack",key:"nexora-checkpoints/acme/p",sha256:"a".repeat(64),bytes:1},
      metadata:{type:"msgpack",key:"nexora-checkpoints/acme/m",sha256:"b".repeat(64),bytes:1},
    },
  });
  assert.equal(result.fencingToken,1);
  assert.equal(x.published[0].tenantId,"acme");
  assert.equal(x.published[0].threadId,"thread-1");
  assert.equal(x.published[0].checkpointNs,"");
});

test("expired lease cannot publish and no D1 checkpoint write is attempted", async () => {
  const x=setup();
  const lease=await x.core.acquire({...x.scope,holderId:"runner-a",ttlMs:5_000});
  x.setNow(15_001);
  await assert.rejects(x.core.publish({
    ...x.scope,holderId:"runner-a",...lease,
    checkpoint:{checkpointId:"cp-1",expectedRevision:0},
  }), (error)=>error.code==="lease_lost");
  assert.equal(x.published.length,0);
});

test("coordinator permanently binds to one tenant/thread/namespace", async () => {
  const x=setup();
  await x.core.acquire({...x.scope,holderId:"runner-a"});
  await assert.rejects(x.core.acquire({...x.scope,tenantId:"other",holderId:"runner-b"}),
    (error)=>error.code==="scope_conflict");
});

test("failed D1 fencing claim clears lease but never reuses the fencing token", async () => {
  const x=setup();
  x.index.failClaim=true;
  await assert.rejects(x.core.acquire({...x.scope,holderId:"runner-a"}));
  assert.equal(x.getState().lease,null);
  x.index.failClaim=false;
  const next=await x.core.acquire({...x.scope,holderId:"runner-b"});
  assert.equal(next.fencingToken,2);
});

test("concurrent acquisitions serialize so only one runner obtains the live lease", async () => {
  const x=setup();
  const results=await Promise.allSettled([
    x.core.acquire({...x.scope,holderId:"runner-a"}),
    x.core.acquire({...x.scope,holderId:"runner-b"}),
  ]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(results.filter(r=>r.status==="rejected" && r.reason.code==="lease_busy").length,1);
});
