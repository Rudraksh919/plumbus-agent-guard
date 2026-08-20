import { BrowserProvider, Contract, Interface, JsonRpcProvider, formatUnits, isAddress, parseUnits } from "ethers";
import "./style.css";

const BASE_SEPOLIA = {
  chainId: "0x14a34",
  chainName: "Base Sepolia",
  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
};
const VAULT_ADDRESS = "0x7cd923ecB9F931357EE20dB5e42776224b47ee2e";
const vaultAbi = [
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function approvedRecipient() view returns (address)",
  "function maxTransferAmount() view returns (uint256)",
  "function plumbus() view returns (address)",
  "function executeTransfer(address recipient, uint256 amount)",
  "error AmountExceedsPolicy()",
  "error NotAgent()",
  "error RecipientNotApproved()",
];
const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
const vaultInterface = new Interface(vaultAbi);

const elements = Object.fromEntries(
  [
    "connect-button", "refresh-button", "vault-balance", "policy-cap", "owner-address", "agent-address",
    "recipient-address", "limit-value", "recipient-input", "amount-input", "safe-scenario", "attack-scenario",
    "execute-button", "intent-message", "intent-badge", "connection-status", "connection-dot", "basescan-link",
  ].map((id) => [id, document.getElementById(id)]),
);

let provider;
let signer;
let policy;

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
  elements["connect-button"].textContent = address ? shortAddress(address) : "Connect wallet";
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
  try {
    if (!provider) provider = new JsonRpcProvider(BASE_SEPOLIA.rpcUrls[0]);
    const contract = vault();
    const [owner, agent, recipient, cap, token] = await Promise.all([
      contract.owner(), contract.agent(), contract.approvedRecipient(), contract.maxTransferAmount(), contract.plumbus(),
    ]);
    const plumbus = new Contract(token, erc20Abi, provider);
    const balance = await plumbus.balanceOf(VAULT_ADDRESS);
    policy = { owner, agent, recipient, cap };

    elements["owner-address"].textContent = shortAddress(owner);
    elements["agent-address"].textContent = shortAddress(agent);
    elements["recipient-address"].textContent = shortAddress(recipient);
    elements["limit-value"].textContent = `${formatUnits(cap, 18)} PLUMBUS`;
    elements["vault-balance"].innerHTML = `${Number(formatUnits(balance, 18)).toLocaleString()} <small>PLUMBUS</small>`;
    elements["policy-cap"].innerHTML = `${formatUnits(cap, 18)} <small>PLUMBUS</small>`;
    elements["recipient-input"].value = recipient;
    elements["basescan-link"].href = `https://sepolia.basescan.org/address/${VAULT_ADDRESS}#code`;
  } catch (error) {
    setMessage("Unable to load the Base Sepolia vault. Check your network connection.", "danger");
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
    await refreshPolicy();
  } catch (error) {
    setMessage(error.shortMessage || "Wallet connection was cancelled.", "danger");
  }
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
    await refreshPolicy();
  } catch (error) {
    setMessage(`Policy blocked action: ${decodePolicyError(error)}`, "danger");
  }
}

elements["connect-button"].addEventListener("click", connect);
elements["refresh-button"].addEventListener("click", refreshPolicy);
elements["safe-scenario"].addEventListener("click", loadSafeScenario);
elements["attack-scenario"].addEventListener("click", loadAttackScenario);
elements["execute-button"].addEventListener("click", executeIntent);
elements["basescan-link"].href = `https://sepolia.basescan.org/address/${VAULT_ADDRESS}#code`;
refreshPolicy();