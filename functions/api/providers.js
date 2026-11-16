import { proxy, json } from "./_gateway.js";

export async function onRequestGet({ request, env }) {
  return proxy(request, env, "/api/providers", "GET");
}
