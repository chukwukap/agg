import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

export async function createMintAndATAs(decimals = 6): Promise<{
  mint: PublicKey;
  source: PublicKey;
  destination: PublicKey;
  feeVault: PublicKey;
}> {
  const mint = await createMint(
    provider.connection,
    provider.wallet.payer,
    provider.wallet.publicKey,
    null,
    decimals
  );
  const source = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      provider.wallet.publicKey
    )
  ).address;
  const destination = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      provider.wallet.publicKey
    )
  ).address;
  const feeVault = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      provider.wallet.publicKey
    )
  ).address;

  // Mint 1_000 tokens to source for swap input
  await mintTo(
    provider.connection,
    provider.wallet.payer,
    mint,
    source,
    provider.wallet.publicKey,
    1_000_000n
  );

  return { mint, source, destination, feeVault };
}

export async function getTokenAmount(ata: PublicKey) {
  const info = await getAccount(provider.connection, ata);
  return info.amount;
}
