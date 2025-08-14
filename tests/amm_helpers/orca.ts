/**
 * Orca Whirlpool helper (SDK v3)
 * ------------------------------------------------------------
 * Creates two fresh SPL mints, bootstraps a minimal Whirlpool
 * (via `createSplashPool`), adds liquidity, and returns a SwapLeg object plus the
 * `remainingAccounts` slice required by the aggregator router.
 *
 * Security: All operations use the test provider's payer and ephemeral mints.
 */

import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

import {
  setRpc,
  setPayerFromBytes,
  setWhirlpoolsConfig,
  createSplashPool,
  swapInstructions,
  openFullRangePosition,
} from "@orca-so/whirlpools";

import { AccountRole, address, createSolanaRpc } from "@solana/kit";

import {
  provider,
  TestPoolAddress,
  TestTokenA,
  TestTokenB,
  WHIRLPOOL_PROGRAM_ID,
} from "../utils";

import { IdlTypes } from "@coral-xyz/anchor";
import { Aggregator as AggregatorIdl } from "../../target/types/aggregator";

// Import AccountRole enum for secure and correct role mapping

type SwapLeg = IdlTypes<AggregatorIdl>["swapLeg"];

/**
 * Main entry point for building an Orca Whirlpool swap leg for testing.
 * This function wires together all helper functions to:
 *  - create two mints with balances
 *  - create a splash pool for those mints
 *  - add full range liquidity to the pool
 *  - build a swap instruction (A -> B)
 *  - return the SwapLeg and remaining accounts for the aggregator router
 */
export async function buildOrcaWhirlpoolLeg(amountIn: bigint, minOut: bigint) {
  // Step 1: Global configuration for the Whirlpool SDK
  setRpc(provider.connection.rpcEndpoint);
  await setPayerFromBytes(provider.wallet.payer.secretKey);
  await setWhirlpoolsConfig("solanaDevnet");

  // Step 2: Create two fresh mints and mint tokens to the payer
  // const TestTokenA = await createMintWithBalance(100_000_000n);
  // const TestTokenB = await createMintWithBalance(100_000_000n);

  console.log("mintA =====>", TestTokenA.toBase58());
  console.log("mintB =====>", TestTokenB.toBase58());

  // Step 3: Create a splash pool for the two mints
  // const poolAddress = await createAndBootstrapSplashPool(
  //   TestTokenA.toBase58(),
  //   TestTokenB.toBase58()
  // );
  console.log("poolAddress =====>", TestPoolAddress);

  // Step 4: Add full range liquidity to the pool (required for swaps to succeed)
  // For test purposes, add 5_000_000 units of token A
  // await addFullRangeLiquidity(TestPoolAddress, 50_000_000n);

  // Step 5: Build the swap instruction (A -> B)
  const rpc = createSolanaRpc(provider.connection.rpcEndpoint);
  // poolAddress is an Address (string-like), as required by swapInstructions
  const { instructions } = await swapInstructions(
    rpc,
    { inputAmount: amountIn, mint: address(TestTokenA.toBase58()) },
    address(TestPoolAddress),
    100 // 1% slippage (bps)
  );

  const ix = instructions[instructions.length - 1];

  console.log("ix =====>", JSON.stringify(ix, null, 2));

  const remainingAccounts = ix.accounts
    // .filter((k) => !new PublicKey(k.address).equals(PublicKey.default))
    .map((k) => mapRoleToMeta(k.address, k.role));

  // Step 6: Translate into aggregator structures
  const leg: SwapLeg = {
    dexId: { orcaWhirlpool: {} },
    inAmount: new anchor.BN(amountIn.toString()),
    minOut: new anchor.BN(minOut.toString()),
    accountCount: remainingAccounts.length,
    data: Buffer.from(ix.data as Uint8Array),
    inMint: TestTokenA,
    outMint: TestTokenB,
  } as SwapLeg;

  return { leg, remainingAccounts };
}

/** Devnet helper: build Whirlpool leg for a known pool and mints */
export async function buildOrcaWhirlpoolLegForPool(
  amountIn: bigint,
  minOut: bigint,
  poolAddressStr: string,
  inputMint: PublicKey,
  outputMint: PublicKey,
  slippageBps = 100
) {
  setRpc(provider.connection.rpcEndpoint);
  await setPayerFromBytes(provider.wallet.payer.secretKey);
  await setWhirlpoolsConfig("solanaDevnet");

  const rpc = createSolanaRpc(provider.connection.rpcEndpoint);
  const { instructions } = await swapInstructions(
    rpc,
    { inputAmount: amountIn, mint: address(inputMint.toBase58()) },
    address(poolAddressStr),
    slippageBps
  );

  const ix = instructions[instructions.length - 1];
  const remainingAccounts = ix.accounts.map((k) =>
    mapRoleToMeta(k.address, k.role)
  );

  const leg: SwapLeg = {
    dexId: { orcaWhirlpool: {} },
    inAmount: new anchor.BN(amountIn.toString()),
    minOut: new anchor.BN(minOut.toString()),
    accountCount: remainingAccounts.length,
    data: Buffer.from(ix.data as Uint8Array),
    inMint: inputMint,
    outMint: outputMint,
  } as SwapLeg;

  return { leg, remainingAccounts };
}

/**
 * Creates a splash pool for two mints and returns the pool address.
 * @param mintA First token mint
 * @param mintB Second token mint
 * @returns The pool address (string)
 */
async function createAndBootstrapSplashPool(mintA: string, mintB: string) {
  setRpc(provider.connection.rpcEndpoint);

  console.log("createSplashPool =====>", mintA, mintB);
  const {
    poolAddress,
    callback: sendTx,
    initializationCost,
    instructions,
  } = await createSplashPool(address(mintA), address(mintB), 0.0001);
  console.log("createSplashPool callback =====>", sendTx);
  const signature = await sendTx();
  console.log(
    `Splash pool created at ${poolAddress} with signature ${signature}`
  );
  return poolAddress;
}

/**
 * Adds full range liquidity to a given splash pool.
 * @param poolAddress The pool address (as a string or PublicKey)
 * @param amountA Amount of token A to add (in native units)
 * @param slippageBps Slippage tolerance in basis points (default: 50 = 0.5%)
 * @returns The position mint and transaction signature
 */
export async function addFullRangeLiquidity(
  poolAddress: string | PublicKey,
  amountA: bigint,
  slippageBps = 50 // 0.5%
) {
  // Security: Always use the correct payer and ensure pool address is valid
  const { positionMint, callback: fullRangeCallback } =
    await openFullRangePosition(
      address(
        typeof poolAddress === "string" ? poolAddress : poolAddress.toBase58()
      ),
      {
        tokenA: amountA,
      },
      slippageBps
    );

  // Execute the transaction to add liquidity
  const fullRangeSig = await fullRangeCallback();
  console.log(
    `Full range position created at ${positionMint} in tx ${fullRangeSig}`
  );
  return { positionMint, fullRangeSig };
}

// Map each Orca SDK role to isSigner/isWritable, safely
function mapRoleToMeta(address: string, role: AccountRole) {
  const isSystemProgram = address === "11111111111111111111111111111111";

  const isSigner =
    !isSystemProgram &&
    (role === AccountRole.WRITABLE_SIGNER ||
      role === AccountRole.READONLY_SIGNER);

  const isWritable =
    role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER;

  return {
    pubkey: new PublicKey(address),
    isSigner,
    isWritable,
  };
}
