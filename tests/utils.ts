import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

// If tests launched via `pnpm test` we run a local validator on 8899.
if (!process.env.ANCHOR_PROVIDER_URL) {
  process.env.ANCHOR_PROVIDER_URL = "http://localhost:8899";
}
if (!process.env.ANCHOR_WALLET) {
  // AnchorProvider.env() requires a keypair path; use default ~/.config/solana/id.json
  process.env.ANCHOR_WALLET = `${process.env.HOME}/.config/solana/id.json`;
}

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

export async function setupTokenAccounts(): Promise<{
  mint: PublicKey;
  ata: PublicKey;
}> {
  const mint = await createMint(
    provider.connection,
    provider.wallet.payer,
    provider.wallet.publicKey,
    null,
    6
  );
  const ata = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      provider.wallet.publicKey
    )
  ).address;
  await mintTo(
    provider.connection,
    provider.wallet.payer,
    mint,
    ata,
    provider.wallet.publicKey,
    1_000_000n
  );
  return { mint, ata };
}
