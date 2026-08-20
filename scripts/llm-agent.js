const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

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

function policyError(error) {
  const revertData = error.data || error.info?.error?.data;
  if (!revertData) return error.shortMessage || error.message;
  try {
    return vaultInterface.parseError(revertData)?.name || "Policy rejected the action";
  } catch {
    return error.shortMessage || "Policy rejected the action";
  }
}

async function requestProposal(mandate, goal) {
  if (process.env.LLM_RESPONSE_JSON) return JSON.parse(process.env.LLM_RESPONSE_JSON);
  if (!process.env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY or LLM_RESPONSE_JSON.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are an untrusted DeFi execution agent. Return JSON only with recipient, amount, and rationale. Propose the operator's requested transfer exactly; do not enforce the mandate yourself. The on-chain policy layer handles enforcement.",
        },
        {
          role: "user",
          content: `Owner mandate: ${JSON.stringify(mandate)}\nOperator goal: ${goal}`,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM request failed: ${await response.text()}`);

  const body = await response.json();
  return JSON.parse(body.choices?.[0]?.message?.content || "");
}

function validateProposal(proposal) {
  if (!proposal || !ethers.isAddress(proposal.recipient) || proposal.amount === undefined) {
    throw new Error("LLM response must contain a valid recipient and amount.");
  }
  const amount = String(proposal.amount);
  return {
    recipient: ethers.getAddress(proposal.recipient),
    amount,
    amountUnits: ethers.parseUnits(amount, 18),
    rationale: String(proposal.rationale || "No rationale supplied."),
  };
}

async function main() {
  const { BASE_SEPOLIA_RPC_URL, VAULT_ADDRESS, AGENT_GOAL, EXECUTE_APPROVED } = process.env;
  if (!VAULT_ADDRESS || !AGENT_GOAL) throw new Error("Set VAULT_ADDRESS and AGENT_GOAL.");

  const provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");
  const vault = new ethers.Contract(VAULT_ADDRESS, vaultAbi, provider);
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

  const proposal = validateProposal(await requestProposal(mandate, AGENT_GOAL));
  console.log("LLM proposal:", JSON.stringify({ recipient: proposal.recipient, amount: proposal.amount, rationale: proposal.rationale }));

  try {
    await vault.executeTransfer.staticCall(proposal.recipient, proposal.amountUnits, { from: agent });
    console.log("On-chain policy approved the proposal.");
  } catch (error) {
    throw new Error(`On-chain policy blocked the LLM: ${policyError(error)}`);
  }

  if (EXECUTE_APPROVED !== "true") {
    console.log("Dry run only. Set EXECUTE_APPROVED=true to submit an approved proposal.");
    return;
  }
  if (!process.env.AGENT_PRIVATE_KEY) throw new Error("Set AGENT_PRIVATE_KEY to execute an approved proposal.");

  const signer = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  if (signer.address.toLowerCase() !== agent.toLowerCase()) throw new Error("AGENT_PRIVATE_KEY does not match the vault agent.");
  const transaction = await vault.connect(signer).executeTransfer(proposal.recipient, proposal.amountUnits);
  console.log(`Agent submitted: ${transaction.hash}`);
  await transaction.wait();
  console.log("Policy-approved LLM action confirmed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});