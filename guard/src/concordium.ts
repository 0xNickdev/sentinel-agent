// A paying fetch for the guard: x402 over Concordium with the `exact` scheme. The payment is a
// sponsored transfer, so the agent needs CCD only for the price, never for fees.
//   import { concordiumPayer } from 'sentinelagent-guard/concordium';
//   const guard = createGuard({ pay: concordiumPayer({ address, privateKeyHex }) });
import { readFileSync } from 'node:fs';
import { AccountAddress, buildAccountSigner, buildBasicAccountSigner, parseWallet } from '@concordium/web-sdk';
import { CONCORDIUM_MAINNET_CAIP2, CONCORDIUM_TESTNET_CAIP2 } from '@x402/concordium';
import { ExactConcordiumScheme } from '@x402/concordium/exact/client';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';

const GRPC = { testnet: 'grpc.testnet.concordium.com:20000', mainnet: 'grpc.mainnet.concordium.software:20000' } as const;

export interface PayerOptions {
  network?: 'testnet' | 'mainnet';
  /** a Concordium wallet export file (Browser Wallet / ID App) … */
  walletFile?: string;
  /** … or an account address with its hex signing key */
  address?: string;
  privateKeyHex?: string;
  /** pay in this asset when the gateway offers it, e.g. 'EUDemo' (an allow-listed PLT: the account must be on its list); CCD otherwise */
  asset?: string | null;
}

export function concordiumPayer(o: PayerOptions): typeof fetch {
  const network = o.network ?? 'testnet';
  let address: AccountAddress.Type, signer;
  if (o.walletFile) {
    const w = parseWallet(readFileSync(o.walletFile, 'utf8'));
    address = AccountAddress.fromBase58(w.value.address); signer = buildAccountSigner(w);
  } else if (o.address && o.privateKeyHex) {
    address = AccountAddress.fromBase58(o.address); signer = buildBasicAccountSigner(o.privateKeyHex);
  } else throw new Error('concordiumPayer: need walletFile, or address + privateKeyHex');
  const caip2 = network === 'mainnet' ? CONCORDIUM_MAINNET_CAIP2 : CONCORDIUM_TESTNET_CAIP2;
  // CCD is not one of x402's default USD-stable assets, so the paying agent allows it explicitly.
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: caip2, client: new ExactConcordiumScheme({ accountAddress: address, signer }, { grpcUrl: GRPC[network], useTls: true }) }],
    // Offers in the preferred asset first; the first offer is the one paid.
    policies: [<R extends { asset: string }>(_v: number, reqs: R[]): R[] => (o.asset ? [...reqs.filter(r => r.asset === o.asset), ...reqs.filter(r => r.asset !== o.asset)] : reqs)],
    spendControls: { allowedAssets: true },
  } as Parameters<typeof wrapFetchWithPaymentFromConfig>[1]) as typeof fetch;
}

/** `<PREFIX>_WALLET`, or `<PREFIX>_ADDRESS` + `<PREFIX>_KEY`, optional `<PREFIX>_ASSET`; null when neither is set. */
export function concordiumPayerFromEnv(prefix = 'CONCORDIUM_PAYER', network: 'testnet' | 'mainnet' = 'testnet'): typeof fetch | null {
  const walletFile = process.env[`${prefix}_WALLET`], address = process.env[`${prefix}_ADDRESS`], privateKeyHex = process.env[`${prefix}_KEY`];
  const asset = process.env[`${prefix}_ASSET`] || null;
  if (walletFile) return concordiumPayer({ network, walletFile, asset });
  if (address && privateKeyHex) return concordiumPayer({ network, address, privateKeyHex, asset });
  return null;
}
