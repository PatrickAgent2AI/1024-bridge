import { Keypair } from '@solana/web3.js';

export const testConfig = {
  guardian: {
    url: process.env.GUARDIAN_URL || 'https://guardian-testnet.bridge.io',
    timeout: 300000,
    retryInterval: 5000,
  },
  
  evm: {
    sepolia: {
      chainId: 11155111,
      rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
      coreContract: process.env.SEPOLIA_CORE_CONTRACT || '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
      privateKey: process.env.TEST_PRIVATE_KEY || '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d',
      confirmations: 1,
    },
    ethereum: {
      chainId: 1,
      rpcUrl: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
      coreContract: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
      privateKey: process.env.TEST_PRIVATE_KEY || '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d',
      confirmations: 12,
    },
  },
  
  solana: {
    chainId: 2,
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    bridgeProgram: process.env.SOLANA_BRIDGE_PROGRAM || 'Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o',
    payerKeypair: Keypair.generate(),
    commitment: 'confirmed' as const,
  },
};

export const fullConfig = {
  guardian: testConfig.guardian,
  evm: testConfig.evm,
  solana: testConfig.solana,
};

export const emptyAccountKey = process.env.EMPTY_ACCOUNT_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';

