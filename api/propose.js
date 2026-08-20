const { propose } = require("../lib/llm-policy");

function readGoal(request) {
  if (typeof request.body === "object" && request.body) return Promise.resolve(request.body.goal);
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) reject(new Error("Request body is too large."));
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body).goal); } catch { reject(new Error("Invalid JSON request.")); }
    });
  });
}

module.exports = async (request, response) => {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed." });
  try {
    const goal = String(await readGoal(request) || "").trim();
    if (!goal || goal.length > 2_000) throw new Error("Enter an agent goal up to 2,000 characters.");
    return response.status(200).json(await propose(goal));
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
};