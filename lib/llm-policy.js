const { ethers } = require("ethers");

const vaultAbi = [
  "function agent() view returns (address)",
  "function approvedRecipient() view returns (address)",
  "function maxTransferAmount() view returns (uint256)",
  "function maxTotalSpend() view returns (uint256)",
  "function spentAmount() view returns (uint256)",
  "function executeTransfer(address recipient, uint256 amount)",
  "error AmountExceedsPolicy()",
  "error NotAgent()",
  "error RecipientNotApproved()",
  "error TotalSpendExceedsPolicy()",
];
const vaultInterface = new ethers.Interface(vaultAbi);

function decodePolicyError(error) {
  const revertData = error.data || error.info?.error?.data;
  if (!revertData) return error.shortMessage || "Policy rejected the action";
  try {
    return vaultInterface.parseError(revertData)?.name || "Policy rejected the action";
  } catch {
    return error.shortMessage || "Policy rejected the action";
  }
}

const systemPrompt = "You are an untrusted DeFi execution agent. Return JSON only with recipient, amount, and rationale. Propose the operator's requested transfer exactly; do not enforce the mandate yourself. The on-chain policy layer handles enforcement.";

function parseProposal(content) {
  return JSON.parse(String(content).replace(/^```json\s*|\s*```$/g, ""));
}

async function askLlm(mandate, goal, apiKey, provider) {
  if (process.env.LLM_RESPONSE_JSON) return JSON.parse(process.env.LLM_RESPONSE_JSON);
  const userPrompt = `Owner mandate: ${JSON.stringify(mandate)}\nOperator goal: ${goal}`;
  const providers = {
    openai: { key: apiKey || process.env.OPENAI_API_KEY, name: "OpenAI" },
    anthropic: { key: apiKey || process.env.ANTHROPIC_API_KEY, name: "Anthropic" },
    gemini: { key: apiKey || process.env.GEMINI_API_KEY, name: "Gemini" },
  };
  const selected = providers[provider];
  if (!selected) throw new Error("Choose OpenAI, Anthropic, or Gemini.");
  if (!selected.key) throw new Error(`Enter a ${selected.name} API key or configure it on the server.`);

  const requests = {
    openai: {
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${selected.key}`, "Content-Type": "application/json" },
      body: { model: process.env.OPENAI_MODEL || "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] },
      read: (body) => body.choices?.[0]?.message?.content,
    },
    anthropic: {
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": selected.key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: { model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest", max_tokens: 300, temperature: 0, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] },
      read: (body) => body.content?.[0]?.text,
    },
    gemini: {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || "gemini-2.0-flash"}:generateContent`,
      headers: { "x-goog-api-key": selected.key, "Content-Type": "application/json" },
      body: { systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: "user", parts: [{ text: userPrompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } },
      read: (body) => body.candidates?.[0]?.content?.parts?.[0]?.text,
    },
  };
  const request = requests[provider];
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
  if (!response.ok) throw new Error("The LLM provider rejected the request. Check the server API key and billing.");
  return parseProposal(request.read(await response.json()));
}

async function propose(goal, { apiKey, provider = "openai" } = {}) {
  if (!process.env.VAULT_ADDRESS) throw new Error("VAULT_ADDRESS is not configured on the server.");
  const rpcProvider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");
  const vault = new ethers.Contract(process.env.VAULT_ADDRESS, vaultAbi, rpcProvider);
  const [agent, approvedRecipient, maxTransferAmount, maxTotalSpend, spentAmount] = await Promise.all([
    vault.agent(), vault.approvedRecipient(), vault.maxTransferAmount(),
    vault.maxTotalSpend(), vault.spentAmount(),
  ]);
  const mandate = {
    agent,
    approvedRecipient,
    maxTransferPlumbus: ethers.formatUnits(maxTransferAmount, 18),
    remainingBudgetPlumbus: ethers.formatUnits(maxTotalSpend - spentAmount, 18),
  };
  const rawProposal = await askLlm(mandate, goal, apiKey, provider);
  if (!ethers.isAddress(rawProposal?.recipient) || rawProposal.amount === undefined) {
    throw new Error("The LLM returned an invalid transfer proposal.");
  }
  const proposal = {
    recipient: ethers.getAddress(rawProposal.recipient),
    amount: String(rawProposal.amount),
    rationale: String(rawProposal.rationale || "No rationale supplied."),
  };

  try {
    await vault.executeTransfer.staticCall(proposal.recipient, ethers.parseUnits(proposal.amount, 18), { from: agent });
    return { mandate, proposal, provider, policy: { allowed: true, message: "On-chain policy approved this proposal." } };
  } catch (error) {
    return { mandate, proposal, provider, policy: { allowed: false, message: decodePolicyError(error) } };
  }
}

module.exports = { propose };