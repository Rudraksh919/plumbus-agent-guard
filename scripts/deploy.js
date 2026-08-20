const { ethers } = require("hardhat");
require("dotenv").config({ path: ".env.local" });

const PLUMBUS = "0x18a0Ea0e27e906097d459E57a32dB07B7071c5F5";

async function main() {
  const [owner] = await ethers.getSigners();
  const agent = process.env.AGENT_ADDRESS;
  const recipient = process.env.APPROVED_RECIPIENT;
  const maxTransfer = process.env.MAX_TRANSFER_PLUMBUS;
  const maxTotalSpend = process.env.MAX_TOTAL_PLUMBUS;

  if (!agent || !recipient || !maxTransfer || !maxTotalSpend) {
    throw new Error("Set AGENT_ADDRESS, APPROVED_RECIPIENT, MAX_TRANSFER_PLUMBUS, and MAX_TOTAL_PLUMBUS.");
  }

  const Vault = await ethers.getContractFactory("AgentPolicyVault");
  const vault = await Vault.deploy(
    PLUMBUS,
    agent,
    recipient,
    ethers.parseUnits(maxTransfer, 18),
    ethers.parseUnits(maxTotalSpend, 18),
  );
  await vault.waitForDeployment();

  console.log(`Owner: ${owner.address}`);
  console.log(`AgentPolicyVault: ${await vault.getAddress()}`);
  console.log("Transfer PLUMBUS to the vault, then let the agent call executeTransfer.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});