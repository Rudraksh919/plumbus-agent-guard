const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentPolicyVault", function () {
  async function deployVault() {
    const [owner, agent, recipient, attacker] = await ethers.getSigners();
    const Plumbus = await ethers.getContractFactory("MockPlumbus");
    const plumbus = await Plumbus.deploy();
    const cap = ethers.parseUnits("100", 18);
    const budget = ethers.parseUnits("200", 18);
    const Vault = await ethers.getContractFactory("AgentPolicyVault");
    const vault = await Vault.deploy(plumbus, agent, recipient, cap, budget);
    await plumbus.mint(vault, ethers.parseUnits("1000", 18));
    return { owner, agent, recipient, attacker, plumbus, vault, cap, budget };
  }

  it("allows the delegated agent to transfer within the owner's mandate", async function () {
    const { agent, recipient, plumbus, vault } = await deployVault();
    const amount = ethers.parseUnits("75", 18);

    await expect(vault.connect(agent).executeTransfer(recipient, amount))
      .to.emit(vault, "AgentTransfer")
      .withArgs(recipient.address, amount);
    expect(await plumbus.balanceOf(recipient)).to.equal(amount);
    expect(await vault.spentAmount()).to.equal(amount);
  });

  it("blocks a compromised agent from exceeding the owner's transfer cap", async function () {
    const { agent, recipient, vault, cap } = await deployVault();

    await expect(vault.connect(agent).executeTransfer(recipient, cap + 1n))
      .to.be.revertedWithCustomError(vault, "AmountExceedsPolicy");
  });

  it("blocks a compromised agent from sending to an unapproved recipient", async function () {
    const { agent, attacker, vault } = await deployVault();

    await expect(vault.connect(agent).executeTransfer(attacker, ethers.parseUnits("1", 18)))
      .to.be.revertedWithCustomError(vault, "RecipientNotApproved");
  });

  it("blocks repeated compliant transfers once the total mandate budget is spent", async function () {
    const { agent, recipient, vault, budget } = await deployVault();
    const firstAmount = ethers.parseUnits("100", 18);

    await vault.connect(agent).executeTransfer(recipient, firstAmount);
    await vault.connect(agent).executeTransfer(recipient, firstAmount);
    expect(await vault.spentAmount()).to.equal(budget);
    await expect(vault.connect(agent).executeTransfer(recipient, 1n))
      .to.be.revertedWithCustomError(vault, "TotalSpendExceedsPolicy");
  });

  it("blocks all vault transfers from wallets other than the delegated agent", async function () {
    const { attacker, recipient, vault } = await deployVault();

    await expect(vault.connect(attacker).executeTransfer(recipient, ethers.parseUnits("1", 18)))
      .to.be.revertedWithCustomError(vault, "NotAgent");
  });

  it("allows only the owner to rotate the mandate and resets its budget", async function () {
    const { owner, agent, recipient, attacker, vault, cap, budget } = await deployVault();
    await vault.connect(agent).executeTransfer(recipient, ethers.parseUnits("50", 18));

    await expect(vault.connect(attacker).setPolicy(attacker, recipient, cap, budget))
      .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await vault.connect(owner).setPolicy(attacker, recipient, cap, budget);

    expect(await vault.agent()).to.equal(attacker.address);
    expect(await vault.spentAmount()).to.equal(0);
    await expect(vault.connect(agent).executeTransfer(recipient, ethers.parseUnits("1", 18)))
      .to.be.revertedWithCustomError(vault, "NotAgent");
  });

  it("does not consume budget when the token transfer reverts", async function () {
    const { agent, recipient, plumbus, vault } = await deployVault();
    await plumbus.burn(vault, ethers.parseUnits("1000", 18));

    await expect(vault.connect(agent).executeTransfer(recipient, ethers.parseUnits("1", 18))).to.be.reverted;
    expect(await vault.spentAmount()).to.equal(0);
  });

  it("rejects invalid owner mandates at deployment", async function () {
    const [, agent, recipient] = await ethers.getSigners();
    const Plumbus = await ethers.getContractFactory("MockPlumbus");
    const plumbus = await Plumbus.deploy();
    const Vault = await ethers.getContractFactory("AgentPolicyVault");
    const cap = ethers.parseUnits("100", 18);

    await expect(Vault.deploy(plumbus, ethers.ZeroAddress, recipient, cap, cap)).to.be.revertedWith("zero address");
    await expect(Vault.deploy(plumbus, agent, recipient, cap, cap - 1n)).to.be.revertedWith("invalid limits");
  });
});