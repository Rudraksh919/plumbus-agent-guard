const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentPolicyVault", function () {
  async function deployVault() {
    const [owner, agent, recipient, attacker] = await ethers.getSigners();
    const Plumbus = await ethers.getContractFactory("MockPlumbus");
    const plumbus = await Plumbus.deploy();
    const cap = ethers.parseUnits("100", 18);
    const Vault = await ethers.getContractFactory("AgentPolicyVault");
    const vault = await Vault.deploy(plumbus, agent, recipient, cap);
    await plumbus.mint(vault, ethers.parseUnits("1000", 18));
    return { agent, recipient, attacker, plumbus, vault, cap };
  }

  it("allows the delegated agent to transfer within the owner's mandate", async function () {
    const { agent, recipient, plumbus, vault } = await deployVault();
    const amount = ethers.parseUnits("75", 18);

    await expect(vault.connect(agent).executeTransfer(recipient, amount))
      .to.emit(vault, "AgentTransfer")
      .withArgs(recipient.address, amount);
    expect(await plumbus.balanceOf(recipient)).to.equal(amount);
  });

  it("blocks a compromised agent from exceeding the owner's transfer cap", async function () {
    const { agent, recipient, vault, cap } = await deployVault();

    await expect(vault.connect(agent).executeTransfer(recipient, cap + 1n))
      .to.be.revertedWithCustomError(vault, "AmountExceedsPolicy");
  });
});