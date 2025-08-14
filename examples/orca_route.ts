/**
 * End-to-end example: build an Orca Whirlpool swap leg and route it via the aggregator.
 *
 * Two approaches are shown:
 *  - Using the Orca SDK to construct the instruction and copying its data + accounts
 *  - Manually serializing the Anchor instruction data (discriminator + args)
 *
 * Security: This example assumes you control the user authority and token accounts.
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { createSolanaRpc, address, AccountRole } from "@solana/kit";
import {
  setRpc,
  setPayerFromBytes,
  setWhirlpoolsConfig,
  swapInstructions,
} from "@orca-so/whirlpools";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Aggregator } from "../target/types/aggregator";

// ---------------- Helper: map SDK roles to metas ----------------
function mapRoleToMeta(addr: string, role: AccountRole) {
  const isSigner =
    role === AccountRole.WRITABLE_SIGNER ||
    role === AccountRole.READONLY_SIGNER;
  const isWritable =
    role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER;
  return { pubkey: new PublicKey(addr), isSigner, isWritable };
}

// ---------------- Helper: manual serialization (Anchor) ----------------
function anchorDiscriminator(ixName: string): Buffer {
  // Anchor sighash: first 8 bytes of sha256("global:" + ixName)
  const preimage = Buffer.from("global:" + ixName, "utf8");
  const digest = require("crypto")
    .createHash("sha256")
    .update(preimage)
    .digest();
  return digest.subarray(0, 8);
}

function encodeU64LE(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}
function encodeU128LE(n: bigint): Buffer {
  const b = Buffer.alloc(16);
  // Split to low/high 64-bit chunks
  const lo = n & ((1n << 64n) - 1n);
  const hi = n >> 64n;
  b.writeBigUInt64LE(lo, 0);
  b.writeBigUInt64LE(hi, 8);
  return b;
}
function encodeBool(v: boolean): Buffer {
  return Buffer.from([v ? 1 : 0]);
}

// Classic Whirlpool swap args layout (IDL):
// amount: u64, otherAmountThreshold: u64, sqrtPriceLimit: u128, amountSpecifiedIsInput: bool, aToB: bool
function buildWhirlpoolSwapDataManual(args: {
  amount: bigint;
  otherAmountThreshold: bigint;
  sqrtPriceLimit: bigint;
  amountSpecifiedIsInput: boolean;
  aToB: boolean;
}): Buffer {
  const disc = anchorDiscriminator("swap");
  return Buffer.concat([
    disc,
    encodeU64LE(args.amount),
    encodeU64LE(args.otherAmountThreshold),
    encodeU128LE(args.sqrtPriceLimit),
    encodeBool(args.amountSpecifiedIsInput),
    encodeBool(args.aToB),
  ]);
}

async function main() {
  // Initialize Anchor provider from env
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.aggregator as anchor.Program<Aggregator>;

  // Configure Orca SDK
  setRpc(provider.connection.rpcEndpoint);
  await setPayerFromBytes((provider.wallet as any).payer.secretKey);
  await setWhirlpoolsConfig("solanaDevnet");

  // Example WSOL/USDC devnet pool
  const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
  const USDC = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD1gYQTeWY5Avzk1H3eZ9Do");
  const POOL = "Ee4SDoT153bMnbAU6YRxbJucZ1vaGLE9ajXhhAEEPYS1";

  const userAuthority = provider.wallet.publicKey;
  const userSource = getAssociatedTokenAddressSync(WSOL, userAuthority);
  const userDestination = getAssociatedTokenAddressSync(USDC, userAuthority);
  const feeVault = userDestination; // fee vault must be admin's ATA for out mint

  // Build swap ix via SDK (recommended)
  const rpc = createSolanaRpc(provider.connection.rpcEndpoint);
  const amountIn = 50_000_000n; // 0.05 SOL in lamports
  const slippageBps = 150;
  const { instructions } = await swapInstructions(
    rpc,
    { inputAmount: amountIn, mint: address(WSOL.toBase58()) },
    address(POOL),
    slippageBps
  );
  const ix = instructions[instructions.length - 1];
  const remainingAccounts = ix.accounts.map((k) =>
    mapRoleToMeta(k.address, k.role)
  );
  // Prepend Whirlpool program account as the first CPI account
  remainingAccounts.unshift({
    pubkey: new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"),
    isSigner: false,
    isWritable: false,
  });

  // Translate to SwapLeg
  const leg = {
    dexId: { orcaWhirlpool: {} } as any,
    inAmount: new anchor.BN(amountIn.toString()),
    minOut: new anchor.BN(1),
    accountCount: remainingAccounts.length,
    data: Buffer.from(ix.data as Uint8Array),
    inMint: WSOL,
    outMint: USDC,
  };

  // Execute route
  const sig = await program.methods
    .route([leg as any], new anchor.BN(amountIn.toString()), new anchor.BN(1))
    .accountsStrict({
      userAuthority,
      userSource,
      userDestination,
      feeVault,
      config: PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        program.programId
      )[0],
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(remainingAccounts)
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_600_000 }),
    ])
    .rpc();

  console.log("aggregator route tx:", sig);

  // --- Manual serialization example (not executed) ---
  const manualData = buildWhirlpoolSwapDataManual({
    amount: amountIn,
    otherAmountThreshold: 1n,
    sqrtPriceLimit: 0n, // 0 = no limit
    amountSpecifiedIsInput: true,
    aToB: true,
  });
  console.log("manual data length:", manualData.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
