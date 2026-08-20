const { propose } = require("../lib/llm-policy");

function readBody(request) {
  if (typeof request.body === "object" && request.body) return Promise.resolve(request.body);
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) reject(new Error("Request body is too large."));
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON request.")); }
    });
  });
}

module.exports = async (request, response) => {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed." });
  try {
    const body = await readBody(request);
    const goal = String(body.goal || "").trim();
    const apiKey = String(body.apiKey || "").trim();
    const provider = String(body.provider || "openai").trim().toLowerCase();
    if (!goal || goal.length > 2_000) throw new Error("Enter an agent goal up to 2,000 characters.");
    if (apiKey.length > 500) throw new Error("Enter an API key up to 500 characters.");
    if (!['openai', 'anthropic', 'gemini'].includes(provider)) throw new Error("Choose OpenAI, Anthropic, or Gemini.");
    return response.status(200).json(await propose(goal, { apiKey, provider }));
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
};