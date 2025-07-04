import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";

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

let cachedConfig: PublicKey | null = null;

export async function getConfigPda(
  program: Program<Aggregator>,
  feeVault: PublicKey,
  feeBps = 0
): Promise<PublicKey> {
  if (cachedConfig) return cachedConfig;
  const [cfg] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  // try fetch – if fails, initialise
  try {
    await program.account.config.fetch(cfg);
  } catch (_) {
    // init
    await program.methods
      .initConfig(feeBps)
      .accounts({ admin: provider.wallet.publicKey, feeVault })
      .rpc();
  }

  cachedConfig = cfg;
  return cfg;
}
