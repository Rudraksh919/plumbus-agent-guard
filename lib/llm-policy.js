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

async function askLlm(mandate, goal, apiKey) {
  if (process.env.LLM_RESPONSE_JSON) return JSON.parse(process.env.LLM_RESPONSE_JSON);
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Enter your OpenAI API key to use the LLM proposal engine.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are an untrusted DeFi execution agent. Return JSON only with recipient, amount, and rationale. Propose the operator's requested transfer exactly; do not enforce the mandate yourself. The on-chain policy layer handles enforcement.",
        },
        { role: "user", content: `Owner mandate: ${JSON.stringify(mandate)}\nOperator goal: ${goal}` },
      ],
    }),
  });
  if (!response.ok) throw new Error("The LLM provider rejected the request. Check the server API key and billing.");
  const body = await response.json();
  return JSON.parse(body.choices?.[0]?.message?.content || "");
}

async function propose(goal, { apiKey } = {}) {
  if (!process.env.VAULT_ADDRESS) throw new Error("VAULT_ADDRESS is not configured on the server.");
  const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");
  const vault = new ethers.Contract(process.env.VAULT_ADDRESS, vaultAbi, provider);
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
  const rawProposal = await askLlm(mandate, goal, apiKey);
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
    return { mandate, proposal, policy: { allowed: true, message: "On-chain policy approved this proposal." } };
  } catch (error) {
    return { mandate, proposal, policy: { allowed: false, message: decodePolicyError(error) } };
  }
}

module.exports = { propose };