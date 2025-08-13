/**
 * Lifinity AMM helper (SDK v2)
 * ------------------------------------------------------------
 * Returns a SwapLeg object plus the `remainingAccounts` slice required by the aggregator router.
 *
 * Security: All operations use the test provider's payer and ephemeral mints.
 *
 * NOTE: This is a test helper for UmbraSwap aggregator integration tests.
 */

import { PublicKey, TransactionInstruction, Connection } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  getPool,
  getAmm,
  getAmountOut,
  getSwapInstruction,
  LIFINITY_PROGRAM_ID,
  getAllPools,
  Pool,
} from "@lifinity/sdk-v2";

import {
  provider,
  TestTokenA,
  TestTokenB,
  // NOTE: The test must provide the user's token accounts for the swap.
} from "../utils";

import { IdlTypes } from "@coral-xyz/anchor";
import { Aggregator as AggregatorIdl } from "../../target/types/aggregator";

/**
 * The SwapLeg type as defined in the aggregator IDL.
 */
type SwapLeg = IdlTypes<AggregatorIdl>["swapLeg"];

/**
 * Main entry point for building a Lifinity swap leg for testing.
 * This function:
 *  - finds a Lifinity pool for the given mints
 *  - builds a swap instruction (A -> B)
 *  - returns the SwapLeg and remaining accounts for the aggregator router
 *
 * Security: Only ephemeral test mints/accounts are used.
 *
 * @param amountIn Amount of input token (bigint)
 * @param minOut Minimum output token amount (bigint)
 * @param fromUserAccount User's input token account (PublicKey)
 * @param toUserAccount User's output token account (PublicKey)
 */
export async function buildLifinityLeg(
  amountIn: bigint,
  minOut: bigint,
  fromUserAccount: PublicKey,
  toUserAccount: PublicKey,
  testPool: Pool
) {
  // Step 1: Setup connection and test accounts
  const connection: Connection = provider.connection;
  const ownerAccount: PublicKey = provider.wallet.publicKey;

  // Step 2: Use test mints and token accounts
  //   const fromMint: PublicKey = TestTokenA;
  //   const toMint: PublicKey = TestTokenB;

  // Step 3: Find the Lifinity pool for these mints
  //   const pool = await getPool(connection, fromMint, toMint);
  if (!testPool) {
    throw new Error("No Lifinity pool found for the given mints");
  }

  // Step 4: Fetch AMM data for the pool
  const ammData = await getAmm(connection, testPool.ammPubkey);

  // Step 5: Calculate output amount and slippage
  const slippagePercent = 1; // 1% slippage
  const amountInNumber = Number(amountIn); // Lifinity SDK expects number
  const minOutNumber = Number(minOut);

  // Optionally, you can use getAmountOut for slippage/price impact info
  // const amountOutInfo = await getAmountOut(
  //   connection,
  //   ammData,
  //   amountInNumber,
  //   fromMint,
  //   slippagePercent
  // );

  // Step 6: Build the swap instruction
  const swapIx: TransactionInstruction = await getSwapInstruction(
    connection,
    ownerAccount,
    amountInNumber,
    minOutNumber,
    ammData,
    testPool.mintA,
    testPool.mintB,
    fromUserAccount,
    toUserAccount
  );

  console.log("swapIx =====>", JSON.stringify(swapIx, null, 2));

  // Step 7: Prepare remaining accounts for the aggregator router
  // Lifinity swap instruction already encodes all accounts, so we extract them
  const remainingAccounts = swapIx.keys;
  console.log(
    "remainingAccounts =====>",
    JSON.stringify(remainingAccounts, null, 2)
  );
  // Step 8: Translate into aggregator structures
  // NOTE: The dexId must match the aggregator IDL's enum variant for Lifinity v2
  const leg: SwapLeg = {
    dexId: { lifinityV2: {} },
    inAmount: new anchor.BN(amountIn.toString()),
    minOut: new anchor.BN(minOut.toString()),
    accountCount: remainingAccounts.length,
    data: swapIx.data,
    inMint: testPool.mintA,
    outMint: testPool.mintB,
  } as unknown as SwapLeg; // Cast to unknown first to satisfy strict enum typing

  return { leg, remainingAccounts };
}
