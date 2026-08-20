# Plumbus Agent Guard

Track 1 submission for PClub x EF: AI Agents x DeFi.

An agent can transfer $PLUMBUS only through an on-chain policy vault. The vault enforces an owner-set agent address, approved recipient, and per-transfer limit, so the agent never controls the vault or its policy.

## Base Sepolia deployment

- Vault: [0x7cd923ecB9F931357EE20dB5e42776224b47ee2e](https://sepolia.basescan.org/address/0x7cd923ecB9F931357EE20dB5e42776224b47ee2e)
- $PLUMBUS: `0x18a0Ea0e27e906097d459E57a32dB07B7071c5F5`
- Allowed transfer: [transaction](https://sepolia.basescan.org/tx/0xb1d3cfb98d5c391a627471ea407856e61e5269b5091918427f81f8d9808a801e)

## Policy

The owner configures:

- A dedicated agent address.
- One approved recipient.
- A maximum transfer of 100 $PLUMBUS.

Only the agent may call `executeTransfer`. The vault rejects a transfer to any other recipient or a transfer greater than 100 $PLUMBUS.

## Run locally

```powershell
npm install
npm test
```

Create `.env.local` with Base Sepolia test-account values. Do not commit it.

```env
PRIVATE_KEY=0xowner_private_key
AGENT_PRIVATE_KEY=0xagent_private_key
AGENT_ADDRESS=0xagent_address
APPROVED_RECIPIENT=0xrecipient_address
MAX_TRANSFER_PLUMBUS=100
AMOUNT_PLUMBUS=75
VAULT_ADDRESS=0xdeployed_vault_address
ETHERSCAN_API_KEY=your_etherscan_v2_api_key
```

Deploy a new vault:

```powershell
npm run deploy:base-sepolia
```

Fund the vault with $PLUMBUS, then run the delegated agent:

```powershell
npm run agent:base-sepolia
```

## Verify the deployment

Create an Etherscan API V2 key, add it to `.env.local`, then verify the deployed contract on Base Sepolia:

```powershell
npx hardhat verify --network baseSepolia 0x7cd923ecB9F931357EE20dB5e42776224b47ee2e 0x18a0Ea0e27e906097d459E57a32dB07B7071c5F5 0x04B3e2f1d3b7Ac344D0D9Eb697A8E060b5a53B99 0x2097A2496970FD67C1Ec5D3c6600393fe8585475 100000000000000000000
```

## Demo results

`AMOUNT_PLUMBUS=75` was accepted and confirmed on Base Sepolia.

`AMOUNT_PLUMBUS=101` was rejected with `Policy blocked action: AmountExceedsPolicy`.