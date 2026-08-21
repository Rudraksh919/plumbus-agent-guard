import { BrowserProvider, Contract, Interface, JsonRpcProvider, formatUnits, isAddress, parseUnits } from "ethers";
import "./style.css";

const BASE_SEPOLIA = {
  chainId: "0x14a34",
  chainName: "Base Sepolia",
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
};
const VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS;
const vaultAbi = [
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function approvedRecipient() view returns (address)",
  "function maxTransferAmount() view returns (uint256)",
  "function maxTotalSpend() view returns (uint256)",
  "function spentAmount() view returns (uint256)",
  "function plumbus() view returns (address)",
  "function executeTransfer(address recipient, uint256 amount)",
  "error AmountExceedsPolicy()",
  "error NotAgent()",
  "error RecipientNotApproved()",
  "error TotalSpendExceedsPolicy()",
];
const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
const vaultInterface = new Interface(vaultAbi);

const elements = Object.fromEntries(
  [
    "connect-button", "refresh-button", "vault-balance", "policy-cap", "owner-address", "agent-address",
    "recipient-address", "limit-value", "budget-value", "policy-budget-value", "recipient-input", "amount-input", "safe-scenario", "attack-scenario",
    "execute-button", "intent-message", "intent-badge", "connection-status", "connection-dot", "basescan-link",
    "change-account-button", "wallet-balance", "wallet-balance-row",
    "llm-goal", "llm-propose-button", "llm-result", "llm-provider", "byok-api-key", "wallet-role", "use-agent-button",
    "audit-log", "clear-audit-button", "network-health", "contract-state",
  ].map((id) => [id, document.getElementById(id)]),
);

let provider;
let signer;
let policy;
const auditStorageKey = "plumbus-guard-audit";
const addressLabels = new Map();

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function displayAddress(address, fallback) {
  if (!addressLabels.has(address)) {
    try {
      addressLabels.set(address, await provider.lookupAddress(address) || fallback);
    } catch {
      addressLabels.set(address, fallback);
    }
  }
  return `${addressLabels.get(address)} / ${shortAddress(address)}`;
}

function setMessage(message, state = "neutral") {
  elements["intent-message"].textContent = message;
  elements["intent-message"].dataset.state = state;
  elements["intent-badge"].textContent = state === "success" ? "Approved" : state === "danger" ? "Blocked" : "Waiting";
  elements["intent-badge"].dataset.state = state;
}

function setConnection(address) {
  elements["connection-status"].textContent = address ? `Connected as ${shortAddress(address)}` : "Wallet not connected";
  elements["connection-dot"].classList.toggle("online", Boolean(address));
  elements["connect-button"].textContent = address ? `Disconnect ${shortAddress(address)}` : "Connect wallet";
  elements["change-account-button"].hidden = !address;
  elements["wallet-role"].hidden = !address;
  elements["use-agent-button"].hidden = !address;
  if (!address) elements["execute-button"].disabled = false;
}

function getAudit() {
  try { return JSON.parse(localStorage.getItem(auditStorageKey) || "[]"); } catch { return []; }
}

function renderAudit() {
  const entries = getAudit();
  if (!entries.length) {
    elements["audit-log"].innerHTML = "<li class=\"audit-empty\">No local decisions yet. Ask the LLM or submit an intent to begin the trace.</li>";
    return;
  }
  elements["audit-log"].replaceChildren(...entries.map((entry) => {
    const item = document.createElement("li");
    item.className = `audit-entry ${entry.state}`;
    item.innerHTML = `<span class="audit-state">${entry.state === "blocked" ? "×" : entry.state === "approved" ? "✓" : "•"}</span><div><strong></strong><p></p></div><time></time>`;
    item.querySelector("strong").textContent = entry.title;
    item.querySelector("p").textContent = entry.detail;
    item.querySelector("time").textContent = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return item;
  }));
}

function addAudit(title, detail, state = "neutral") {
  const entries = [{ title, detail, state, at: Date.now() }, ...getAudit()].slice(0, 8);
  try { localStorage.setItem(auditStorageKey, JSON.stringify(entries)); } catch { /* Local audit is optional. */ }
  renderAudit();
}

async function ensureBaseSepolia() {
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId === BASE_SEPOLIA.chainId) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_SEPOLIA.chainId }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [BASE_SEPOLIA] });
  }
}

function vault() {
  return new Contract(VAULT_ADDRESS, vaultAbi, signer || provider);
}

async function refreshPolicy() {
  if (!isAddress(VAULT_ADDRESS)) {
    elements["contract-state"].textContent = "Not configured";
    elements["network-health"].textContent = "VITE_VAULT_ADDRESS required";
    elements["basescan-link"].removeAttribute("href");
    setMessage("This deployment needs VITE_VAULT_ADDRESS set to the new Base Sepolia vault, then rebuilt.", "danger");
    return;
  }
  try {
    if (!provider) provider = new JsonRpcProvider(BASE_SEPOLIA.rpcUrls[0]);
    const contract = vault();
    const [owner, agent, recipient, cap, maxTotalSpend, spentAmount, token] = await Promise.all([
      contract.owner(), contract.agent(), contract.approvedRecipient(), contract.maxTransferAmount(),
      contract.maxTotalSpend(), contract.spentAmount(), contract.plumbus(),
    ]);
    const plumbus = new Contract(token, erc20Abi, provider);
    const connectedAddress = signer ? await signer.getAddress() : undefined;
    const [balance, connectedBalance] = await Promise.all([
      plumbus.balanceOf(VAULT_ADDRESS),
      connectedAddress ? plumbus.balanceOf(connectedAddress) : Promise.resolve(undefined),
    ]);
    policy = { owner, agent, recipient, cap, remainingBudget: maxTotalSpend - spentAmount };

    const [ownerLabel, agentLabel, recipientLabel] = await Promise.all([
      displayAddress(owner, "Vault Owner"),
      displayAddress(agent, "Deployed Agent"),
      displayAddress(recipient, recipient.toLowerCase() === owner.toLowerCase() ? "Vault Owner" : "Approved Recipient"),
    ]);
    elements["owner-address"].textContent = ownerLabel;
    elements["agent-address"].textContent = agentLabel;
    elements["recipient-address"].textContent = recipientLabel;
    elements["limit-value"].textContent = `${formatUnits(cap, 18)} PLUMBUS`;
    elements["budget-value"].textContent = `${formatUnits(maxTotalSpend - spentAmount, 18)} PLUMBUS`;
    elements["policy-budget-value"].textContent = `${formatUnits(maxTotalSpend - spentAmount, 18)} PLUMBUS`;
    elements["vault-balance"].innerHTML = `${Number(formatUnits(balance, 18)).toLocaleString()} <small>PLUMBUS</small>`;
    elements["policy-cap"].innerHTML = `${formatUnits(cap, 18)} <small>PLUMBUS</small>`;
    elements["recipient-input"].value = recipient;
    elements["basescan-link"].href = `https://sepolia.basescan.org/address/${VAULT_ADDRESS}#code`;
    elements["wallet-balance-row"].hidden = !connectedAddress;
    if (connectedBalance !== undefined) {
      elements["wallet-balance"].textContent = `${formatUnits(connectedBalance, 18)} PLUMBUS`;
    }
    if (connectedAddress) {
      const isAgent = connectedAddress.toLowerCase() === agent.toLowerCase();
      const isOwner = connectedAddress.toLowerCase() === owner.toLowerCase();
      const connectedRole = isAgent ? "Deployed Agent" : isOwner ? "Vault Owner" : "Observer wallet";
      elements["connection-status"].textContent = `Connected as ${connectedRole} / ${shortAddress(connectedAddress)}`;
      elements["wallet-role"].textContent = isAgent ? "Agent authority" : "Observer mode";
      elements["wallet-role"].dataset.role = isAgent ? "agent" : "observer";
      elements["execute-button"].disabled = !isAgent;
      elements["use-agent-button"].hidden = isAgent;
    }
    elements["contract-state"].textContent = "Verified";
    elements["contract-state"].className = "verified";
    elements["network-health"].textContent = "Base Sepolia live";
  } catch (error) {
    elements["contract-state"].textContent = "Unavailable";
    elements["contract-state"].className = "";
    elements["network-health"].textContent = "RPC or contract unavailable";
    setMessage("Unable to load the configured Base Sepolia vault. Check its address and network connection.", "danger");
  }
}

async function connect() {
  if (!window.ethereum) {
    setMessage("MetaMask is required to connect an agent account.", "danger");
    return;
  }
  try {
    await ensureBaseSepolia();
    provider = new BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    setConnection(await signer.getAddress());
    addAudit("Wallet connected", `Signer ${shortAddress(await signer.getAddress())} is ready on Base Sepolia.`);
    await refreshPolicy();
  } catch (error) {
    setMessage(error.shortMessage || "Wallet connection was cancelled.", "danger");
  }
}

async function disconnect() {
  signer = undefined;
  provider = new JsonRpcProvider(BASE_SEPOLIA.rpcUrls[0]);
  setConnection();
  addAudit("Wallet disconnected", "The dashboard returned to read-only policy monitoring.");
  setMessage("Wallet disconnected from this app. Vault data remains available in read-only mode.");
  await refreshPolicy();
}

async function switchAccount() {
  if (!window.ethereum) {
    setMessage("MetaMask is required to switch accounts.", "danger");
    return;
  }
  try {
    await window.ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    await connect();
  } catch (error) {
    setMessage(error.shortMessage || "Account switch was cancelled.", "danger");
  }
}

async function useDeployedAgent() {
  if (!window.ethereum || !policy) return;
  try {
    provider = new BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_accounts", []);
    const agentAccount = accounts.find((account) => account.toLowerCase() === policy.agent.toLowerCase());
    if (!agentAccount) {
      setMessage("Click Switch account and grant access to the deployed Agent account.", "danger");
      return;
    }
    signer = await provider.getSigner(agentAccount);
    setConnection(agentAccount);
    await refreshPolicy();
    addAudit("Agent selected", `Signer ${shortAddress(agentAccount)} now has the vault's execution authority.`);
  } catch (error) {
    setMessage(error.shortMessage || "Unable to select the deployed Agent account.", "danger");
  }
}

if (window.ethereum) {
  window.ethereum.on("accountsChanged", async (accounts) => {
    if (!accounts.length) return disconnect();
    provider = new BrowserProvider(window.ethereum);
    signer = await provider.getSigner(accounts[0]);
    setConnection(accounts[0]);
    await refreshPolicy();
  });

  window.ethereum.on("chainChanged", async (chainId) => {
    if (chainId !== BASE_SEPOLIA.chainId) {
      await disconnect();
      setMessage("Network changed. Switch back to Base Sepolia before executing an agent action.", "danger");
      return;
    }
    if (signer) {
      provider = new BrowserProvider(window.ethereum);
      signer = await provider.getSigner();
      setConnection(await signer.getAddress());
      await refreshPolicy();
    }
  });
}

function loadSafeScenario() {
  if (!policy) return setMessage("Load the vault policy first.", "danger");
  elements["recipient-input"].value = policy.recipient;
  elements["amount-input"].value = "75";
  setMessage("Permitted intent loaded. It stays within the recipient and amount mandate.");
}

function loadAttackScenario() {
  elements["recipient-input"].value = "0x000000000000000000000000000000000000dEaD";
  elements["amount-input"].value = "1000";
  setMessage("Hostile intent loaded. The vault should block this request before funds move.", "danger");
}

function decodePolicyError(error) {
  const revertData = error.data || error.info?.error?.data;
  if (!revertData) return error.shortMessage || error.message;
  try {
    return vaultInterface.parseError(revertData)?.name || "Policy rejected the action";
  } catch {
    return error.shortMessage || "Policy rejected the action";
  }
}

async function executeIntent() {
  if (!signer) return connect();
  await ensureBaseSepolia();
  provider = new BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  const recipient = elements["recipient-input"].value.trim();
  const amount = elements["amount-input"].value.trim();
  if (!isAddress(recipient) || !amount || Number(amount) <= 0) {
    setMessage("Enter a valid recipient and a positive PLUMBUS amount.", "danger");
    return;
  }
  try {
    const amountUnits = parseUnits(amount, 18);
    const contract = vault();
    setMessage("Checking the proposed intent against the on-chain policy...");
    await contract.executeTransfer.staticCall(recipient, amountUnits);
    setMessage("Policy approved. Confirm the Base Sepolia transaction in MetaMask.", "success");
    const transaction = await contract.executeTransfer(recipient, amountUnits);
    setMessage(`Transaction submitted: ${shortAddress(transaction.hash)}. Waiting for confirmation...`, "success");
    await transaction.wait();
    setMessage("Policy-approved transfer confirmed on Base Sepolia.", "success");
    addAudit("Transfer confirmed", `${amount} PLUMBUS reached ${shortAddress(recipient)} through the policy vault.`, "approved");
    await refreshPolicy();
  } catch (error) {
    const reason = decodePolicyError(error);
    setMessage(`Policy blocked action: ${reason}`, "danger");
    addAudit("Manual intent blocked", reason, "blocked");
  }
}

async function requestLlmProposal() {
  const goal = elements["llm-goal"].value.trim();
  const apiKey = elements["byok-api-key"].value.trim();
  const providerName = elements["llm-provider"].value;
  if (!goal) {
    elements["llm-result"].textContent = "Enter an LLM agent goal first.";
    return;
  }
  elements["llm-propose-button"].disabled = true;
  elements["llm-result"].textContent = "Asking the LLM for a proposal and checking the live policy...";
  try {
    const response = await fetch("/api/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, apiKey, provider: providerName }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "LLM proposal failed.");

    elements["recipient-input"].value = result.proposal.recipient;
    elements["amount-input"].value = result.proposal.amount;
    const summary = `LLM proposed ${result.proposal.amount} PLUMBUS to ${shortAddress(result.proposal.recipient)}. ${result.proposal.rationale}`;
    if (result.policy.allowed) {
      elements["llm-result"].textContent = `${summary} Policy approved: ${result.policy.message}`;
      setMessage("LLM proposal passed the on-chain preflight. Connect the Agent wallet to execute it.", "success");
      addAudit("LLM proposal approved", `${result.proposal.amount} PLUMBUS to ${shortAddress(result.proposal.recipient)} passed the policy preflight.`, "approved");
    } else {
      elements["llm-result"].textContent = `${summary} Policy blocked: ${result.policy.message}`;
      setMessage(`Policy blocked the LLM proposal: ${result.policy.message}`, "danger");
      addAudit("LLM proposal blocked", `${result.policy.message}: ${result.proposal.amount} PLUMBUS to ${shortAddress(result.proposal.recipient)}.`, "blocked");
    }
  } catch (error) {
    elements["llm-result"].textContent = error.message;
    setMessage("LLM proposal could not be completed.", "danger");
  } finally {
    elements["byok-api-key"].value = "";
    elements["llm-propose-button"].disabled = false;
  }
}

elements["connect-button"].addEventListener("click", () => signer ? disconnect() : connect());
elements["change-account-button"].addEventListener("click", switchAccount);
elements["use-agent-button"].addEventListener("click", useDeployedAgent);
elements["refresh-button"].addEventListener("click", refreshPolicy);
elements["safe-scenario"].addEventListener("click", loadSafeScenario);
elements["attack-scenario"].addEventListener("click", loadAttackScenario);
elements["execute-button"].addEventListener("click", executeIntent);
elements["llm-propose-button"].addEventListener("click", requestLlmProposal);
elements["llm-provider"].addEventListener("change", () => {
  const placeholders = { openai: "sk-...", anthropic: "sk-ant-...", gemini: "AIza..." };
  elements["byok-api-key"].placeholder = placeholders[elements["llm-provider"].value];
});
document.querySelectorAll("[data-goal]").forEach((button) => button.addEventListener("click", () => {
  elements["llm-goal"].value = button.dataset.goal;
  elements["llm-goal"].focus();
}));
elements["clear-audit-button"].addEventListener("click", () => {
  localStorage.removeItem(auditStorageKey);
  renderAudit();
});
elements["basescan-link"].href = `https://sepolia.basescan.org/address/${VAULT_ADDRESS}#code`;
renderAudit();
refreshPolicy();