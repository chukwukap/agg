import {
  Address,
  generateKeyPairSigner,
  getAddressEncoder,
  MessageSigner,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import {
  fetchMint,
  getInitializeMint2Instruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  createSplashPool,
  orderMints,
  setWhirlpoolsConfig,
  setRpc as setRpcActions,
} from "@orca-so/whirlpools";
import { fetchWhirlpool } from "@orca-so/whirlpools-client";
import { sqrtPriceToPrice } from "@orca-so/whirlpools-core";
import { getCreateAccountInstruction } from "@solana-program/system";
import { buildTransaction, setRpc } from "@orca-so/tx-sender";
import { Client, createClient } from "./client";
import { ANCHOR_PROVIDER_URL } from "./utils";

// What is a SplashPool?
// SplashPools are built on top of Orca's CLMM, but behave similar to a Constant Product AMM.
// - it is a Whirlpool with a specific tick_spacing. SplashPool can be handled as Whirlpool.
// - it has only 2 TickArrays (simple, low cost), which are initialized in the createSplashPool function.
// - it allows FullRange positions only (similar to Constant Product AMM)
export async function createSplashPoolTest(client: Client) {
  await setRpc(ANCHOR_PROVIDER_URL);
  await setRpcActions(ANCHOR_PROVIDER_URL);
  await setWhirlpoolsConfig("solanaDevnet");
  // Create new token mints. Note that the in a more realistic scenario,
  // the mints are generated beforehand.
  const newTokenPubkeys = await Promise.all([
    createNewTokenMint(
      client,
      client.wallet,
      client.wallet.address,
      client.wallet.address,
      9
    ),
    createNewTokenMint(
      client,
      client.wallet,
      client.wallet.address,
      client.wallet.address,
      6
    ),
  ]);

  // Token A and Token B Mint has to be cardinally ordered
  // For example, SOL/USDC can be created, but USDC/SOL cannot be created
  const [tokenAddressA, tokenAddressB] = orderMints(
    newTokenPubkeys[0],
    newTokenPubkeys[1]
  );

  // Fetch token mint infos
  const tokenA = await fetchMint(client.rpc, tokenAddressA);
  const tokenB = await fetchMint(client.rpc, tokenAddressB);
  const decimalA = tokenA.data.decimals;
  const decimalB = tokenB.data.decimals;
  console.log("tokenA:", tokenAddressA, "decimalA:", decimalA);
  console.log("tokenB:", tokenAddressB, "decimalB:", decimalB);

  // Set the price of token A in terms of token B
  const initialPrice = 0.01;

  // Create a new pool
  const { poolAddress, callback: sendTx } = await createSplashPool(
    tokenAddressA,
    tokenAddressB,
    initialPrice
  );
  const signature = await sendTx();

  // Fetch pool data to verify the initial price and tick
  const pool = await fetchWhirlpool(client.rpc, poolAddress);
  const poolData = pool.data;
  const poolInitialPrice = sqrtPriceToPrice(
    poolData.sqrtPrice,
    decimalA,
    decimalB
  );
  const poolInitialTick = poolData.tickCurrentIndex;

  console.log("txId:", signature);
  console.log(
    "poolAddress:",
    poolAddress.toString(),
    "\n  tokenA:",
    poolData.tokenMintA.toString(),
    "\n  tokenB:",
    poolData.tokenMintB.toString(),
    "\n  tickSpacing:",
    poolData.tickSpacing,
    "\n  initialPrice:",
    poolInitialPrice,
    "\n  initialTick:",
    poolInitialTick
  );
  return {
    poolAddress,
    tokenAddressA,
    tokenAddressB,
    decimalA,
    decimalB,
  };
}

async function createNewTokenMint(
  client: Client,
  signer: TransactionSigner & MessageSigner,
  mintAuthority: Address,
  freezeAuthority: Address,
  decimals: number
) {
  const latestBlockhash = (await client.rpc.getLatestBlockhash().send()).value;
  const keypair = await generateKeyPairSigner();
  const mintLen = 82;
  const lamports = await client.rpc
    .getMinimumBalanceForRentExemption(BigInt(mintLen))
    .send();
  const createAccountInstruction = getCreateAccountInstruction({
    payer: signer,
    newAccount: keypair,
    lamports,
    space: mintLen,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  });

  const initializeMintInstruction = getInitializeMint2Instruction({
    mint: keypair.address,
    decimals,
    mintAuthority,
    freezeAuthority,
  });

  const transaction = await buildTransaction(
    [createAccountInstruction, initializeMintInstruction],
    signer
  );

  await client.sendAndConfirmTransaction(
    {
      ...transaction,
      lifetimeConstraint: {
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
    },
    {
      commitment: "confirmed",
    }
  );

  return keypair.address;
}
