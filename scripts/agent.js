const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const vaultAbi = [
  "function executeTransfer(address recipient, uint256 amount) external",
  "error AmountExceedsPolicy()",
  "error NotAgent()",
  "error RecipientNotApproved()",
];
const vaultInterface = new ethers.Interface(vaultAbi);

async function main() {
  const { AGENT_PRIVATE_KEY, BASE_SEPOLIA_RPC_URL, VAULT_ADDRESS, APPROVED_RECIPIENT, AMOUNT_PLUMBUS } = process.env;
  if (!AGENT_PRIVATE_KEY || !VAULT_ADDRESS || !APPROVED_RECIPIENT || !AMOUNT_PLUMBUS) {
    throw new Error("Set AGENT_PRIVATE_KEY, VAULT_ADDRESS, APPROVED_RECIPIENT, and AMOUNT_PLUMBUS.");
  }

  const provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");
  const agent = new ethers.Wallet(AGENT_PRIVATE_KEY, provider);
  const vault = new ethers.Contract(VAULT_ADDRESS, vaultAbi, agent);
  const transaction = await vault.executeTransfer(
    APPROVED_RECIPIENT,
    ethers.parseUnits(AMOUNT_PLUMBUS, 18),
  );

  console.log(`Agent submitted: ${transaction.hash}`);
  await transaction.wait();
  console.log("Policy-approved transfer confirmed.");
}

main().catch((error) => {
  const revertData = error.data || error.info?.error?.data;
  const policyError = revertData ? vaultInterface.parseError(revertData) : null;
  console.error(policyError ? `Policy blocked action: ${policyError.name}` : error.shortMessage || error.message);
  process.exitCode = 1;
});