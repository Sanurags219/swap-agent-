import { http, createConfig } from 'wagmi';
import { celo, celoAlfajores } from 'viem/chains';
import { coinbaseWallet } from '@wagmi/connectors';

export const config = createConfig({
  chains: [celo, celoAlfajores],
  connectors: [
    coinbaseWallet({
      appName: 'Celo Swap Agent',
      preference: 'smartWalletOnly',
    }),
  ],
  transports: {
    [celo.id]: http(),
    [celoAlfajores.id]: http(),
  },
});
