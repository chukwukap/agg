import "dotenv/config";

import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  mintTo,
} from "@solana/spl-token";

import { PublicKey, Transaction } from "@solana/web3.js";
import { Aggregator } from "../target/types/aggregator";

// Global provider (same as Anchor CLI), but allow overriding to devnet within tests
export let provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

export function setProvider(p: anchor.AnchorProvider) {
  provider = p;
  anchor.setProvider(provider);
}

export function setDevnetProvider(rpcUrl?: string) {
  const url =
    rpcUrl ||
    process.env.ANCHOR_PROVIDER_URL ||
    "https://api.devnet.solana.com";
  const conn = new anchor.web3.Connection(url, "confirmed");
  const newProvider = new anchor.AnchorProvider(conn, provider.wallet, {
    commitment: "confirmed",
  });
  setProvider(newProvider);
}

/**
 * Create a fresh 6-decimals SPL mint and a funded ATA for the provider wallet.
 * Returns the mint and the ATA address.
 * Also requests an airdrop to ensure the payer has enough SOL for test transactions.
 *
 * Security: Ensures payer is funded before minting to avoid transaction failures.
 */
export async function setupTokenAccounts(amount: bigint = 1_000_000n) {
  const connection = provider.connection;
  const payer = provider.wallet.payer;

  // Request airdrop to ensure payer has enough SOL for fees
  const { publicKey } = payer;
  const balance = await connection.getBalance(publicKey);
  const minLamports = 2_000_000_000; // 2 SOL in lamports

  if (balance < minLamports) {
    const sig = await connection.requestAirdrop(
      publicKey,
      minLamports - balance
    );
    await connection.confirmTransaction(sig, "confirmed");
  }

  // 1. Create mint (mint authority = payer)
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    6 // decimals
  );

  // 2. Create (or fetch) ATA owned by the provider wallet
  const ata = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      provider.wallet.publicKey
    )
  ).address;

  // 3. Mint initial supply to ATA
  await (
    await import("@solana/spl-token")
  ).mintTo(connection, payer, mint, ata, payer, amount);

  return { mint, ata };
}

/**
 * PDA helpers – replicated here to avoid importing on-chain code.
 */
export function getConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    anchor.workspace.aggregator.programId
  );
}

/**
 * Ensure the global Config PDA exists with `fee_bps = 200` (2%) and fee_vault = provider's ATA.
 * Creates the account on first call; subsequent calls are no-ops.
 */
export async function ensureTestConfig(mint: PublicKey, feeBps = 200) {
  const program = anchor.workspace.aggregator as anchor.Program<Aggregator>;
  const [configPda] = getConfigPda();

  try {
    await program.account.config.fetch(configPda);
    return; // already initialised
  } catch (_) {
    await program.methods
      .initConfig(feeBps)
      .accounts({
        admin: provider.wallet.publicKey,
      })
      .rpc();
  }
}

/**
 * Construct a dummy SwapLeg for the fake Lifinity adapter (no remaining accounts required).
 */
export function buildDummyLeg(
  mint: PublicKey,
  inAmount = 1_000n,
  outAmount = 900n
) {
  return {
    dexId: { lifinityV2: {} } as any,
    inAmount: new anchor.BN(inAmount),
    minOut: new anchor.BN(outAmount),
    accountCount: 0,
    data: Buffer.alloc(0),
    inMint: mint,
    outMint: mint,
  };
}

/** Return SPL-token balance of given ATA */
export async function getTokenBalance(ata: PublicKey): Promise<bigint> {
  const acc = await getAccount(provider.connection, ata);
  return acc.amount;
}

/** Build an array with `n` identical dummy legs (for CU stress test). */
export function repeatLeg(leg: any, n: number): any[] {
  return Array.from({ length: n }, () => ({ ...leg }));
}

export async function createAtaForMint(mint: PublicKey, owner: PublicKey) {
  const ata = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      owner
    )
  ).address;
  return ata;
}

export async function requestAirdrop(
  pubkey: PublicKey,
  amount: bigint = 1_000_000_000_000_000_000n // 1 SOL
) {
  return provider.connection.requestAirdrop(pubkey, Number(amount));
}

/**
 * Creates a new SPL mint, an associated token account for the payer, and mints the specified amount.
 * @param amount Amount to mint (in native units)
 * @returns The mint's PublicKey
 */
export async function createMintWithBalance(
  amount: bigint
): Promise<PublicKey> {
  const connection = provider.connection;
  const payer = provider.wallet.payer;

  // Create a new mint with 6 decimals
  const mint = await createMint(connection, payer, payer.publicKey, null, 6);
  const ata = getAssociatedTokenAddressSync(mint, payer.publicKey);

  // Create the associated token account for the payer
  await provider.sendAndConfirm(
    new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        payer.publicKey,
        mint
      )
    )
  );

  // Mint the specified amount to the payer's ATA
  if (amount > 0n) {
    await mintTo(connection, payer, mint, ata, payer, amount);
  }

  return mint;
}

export const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);

export const LIFINITY_PROGRAM_ID = new PublicKey(
  "2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c"
);

// this tokens and pools are on solana devnet
export const OrcaTestTokenA = new PublicKey(
  "8PCG6MYJpM6xbVjAYgWF23XLjhpzGHTmFrcNReeQ7yeR"
);
export const OrcaTestTokenB = new PublicKey(
  "HbCVgB4Pi4dc3MNp5j1PCKtDmP9ZgJukgBUSPKQAVXoq"
);

// splash pool
export const OrcaTestPoolAddress =
  "Ee4SDoT153bMnbAU6YRxbJucZ1vaGLE9ajXhhAEEPYS1";
