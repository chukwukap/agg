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

import * as utils from "../utils";

import { IdlTypes } from "@coral-xyz/anchor";
import { Aggregator as AggregatorIdl } from "../../target/types/aggregator";

// Import AccountRole enum for secure and correct role mapping

type SwapLeg = IdlTypes<AggregatorIdl>["swapLeg"];

// /** Devnet helper: build Whirlpool leg for a known pool and mints */
export async function buildOrcaWhirlpoolLegForPool(
  amountIn: bigint,
  minOut: bigint,
  poolAddressStr: string,
  inputMint: PublicKey,
  outputMint: PublicKey,
  slippageBps = 100
) {
  setRpc(utils.provider.connection.rpcEndpoint);
  await setPayerFromBytes(utils.provider.wallet.payer.secretKey);
  await setWhirlpoolsConfig("solanaDevnet");

  const rpc = createSolanaRpc(utils.provider.connection.rpcEndpoint);
  const { instructions, quote } = await swapInstructions(
    rpc,
    { inputAmount: amountIn, mint: address(inputMint.toBase58()) },
    address(poolAddressStr),
    slippageBps
  );
  console.log("quote", quote);
  // // Prepend the Whirlpool program account required by CPI
  // remainingAccounts.unshift({
  //   pubkey: utils.WHIRLPOOL_PROGRAM_ID,
  //   isSigner: false,
  //   isWritable: false,
  // });
  const ix = instructions[instructions.length - 1];
  // Map readonly SDK accounts -> mutable AccountMeta[] for Anchor .remainingAccounts()
  const remainingAccounts = Array.from(ix.accounts).map((k) =>
    mapRoleToMeta(k.address, k.role)
  );
  // Prepend Whirlpool program account for CPI
  remainingAccounts.unshift({
    pubkey: utils.WHIRLPOOL_PROGRAM_ID,
    isSigner: false,
    isWritable: false,
  });
  console.log("remainingAccounts", remainingAccounts);
  const leg: SwapLeg = {
    dexId: { orcaWhirlpool: {} },
    inAmount: new anchor.BN(amountIn.toString()),
    minOut: new anchor.BN(minOut.toString()),
    accountCount: remainingAccounts.length,
    data: Buffer.from(ix.data.buffer),
    inMint: inputMint,
    outMint: outputMint,
  };

  return { leg, remainingAccounts };
}

/**
 * Creates a splash pool for two mints and returns the pool address.
 * @param mintA First token mint
 * @param mintB Second token mint
 * @returns The pool address (string)
 */
async function createAndBootstrapSplashPool(mintA: string, mintB: string) {
  setRpc(utils.provider.connection.rpcEndpoint);

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

// Map Orca SDK account roles to web3.js AccountMeta
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
