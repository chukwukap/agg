import * as programClient from "../clients/generated";
import {
  address,
  type Address,
  appendTransactionMessageInstructions,
  Blockhash,
  createTransactionMessage,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { Client, createClient } from "./client";
import { expect } from "chai";
import {
  OrcaTestPoolAddress,
  OrcaTestTokenB,
  OrcaTestTokenA,
  ANCHOR_PROVIDER_URL,
} from "./utils";
import {
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstruction,
} from "@solana-program/token";
import {
  createAssociatedTokenAccountIdempotent,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { setRpc, setWhirlpoolsConfig, swap } from "@orca-so/whirlpools";
import { getWhirlpoolAddress } from "@orca-so/whirlpools-client";

describe("integration: router behaviour (devnet)", function () {
  this.timeout(20000); // allow 20s for on-chain pool bootstrap
  let client: Client;
  let tokenAMint: Address;
  let tokenBMint: Address;
  let decimalA: number;
  let decimalB: number;
  let pool: Address;
  let configPda: Address;
  let latestBlockhash: {
    blockhash: Blockhash;
    lastValidBlockHeight: bigint;
  };

  before("setup token accounts (devnet)", async function () {
    client = await createClient();

    pool = OrcaTestPoolAddress;
    tokenAMint = OrcaTestTokenA;
    tokenBMint = OrcaTestTokenB;
    decimalA = (await fetchMint(client.rpc, tokenAMint)).data.decimals;
    decimalB = (await fetchMint(client.rpc, tokenBMint)).data.decimals;
    latestBlockhash = (await client.rpc.getLatestBlockhash().send()).value;
    const configPdaAndBump = await getProgramDerivedAddress({
      programAddress: programClient.AGGREGATOR_PROGRAM_ADDRESS,
      seeds: ["config"],
    });
    configPda = configPdaAndBump[0];
  });

  it.skip("(config) initializes the program config correctly", async function () {
    const initConfigIx = programClient.getInitConfigInstruction({
      feeBps: 100, // 1%
      admin: client.wallet,
      config: configPda,
    });

    // Build the transaction message.
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(client.wallet, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([initConfigIx], tx)
    );

    // Compile the transaction message and sign it.
    const transaction = await signTransactionMessageWithSigners(
      transactionMessage
    );

    const signature = await client.sendAndConfirmTransaction(transaction, {
      commitment: "confirmed",
    });
    console.log("signature", signature);

    const config = await programClient.fetchConfig(client.rpc, configPda);
    console.log("config", config);
    expect(config.data.feeBps).to.equal(100);
    expect(config.data.admin).to.equal(client.wallet.address);
    expect(config.data.paused).to.equal(false);
  });

  it.skip("(pause) pauses the program by admin", async function () {
    const pauseIx = programClient.getPauseInstruction({
      config: configPda,
      admin: client.wallet,
    });

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(client.wallet, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([pauseIx], tx)
    );

    const transaction = await signTransactionMessageWithSigners(
      transactionMessage
    );
    const signature = await client.sendAndConfirmTransaction(transaction, {
      commitment: "confirmed",
    });
    console.log("signature", signature);

    const config = await programClient.fetchConfig(client.rpc, configPda);
    console.log("config", config);
    expect(config.data.paused).to.equal(true);
  });

  it.skip("(unpause) unpauses the program by admin", async function () {
    const unpauseIx = programClient.getUnpauseInstruction({
      config: configPda,
      admin: client.wallet,
    });

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(client.wallet, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([unpauseIx], tx)
    );

    const transaction = await signTransactionMessageWithSigners(
      transactionMessage
    );
    const signature = await client.sendAndConfirmTransaction(transaction, {
      commitment: "confirmed",
    });
    console.log("signature", signature);

    const config = await programClient.fetchConfig(client.rpc, configPda);
    console.log("config", config);
    expect(config.data.paused).to.equal(false);
  });

  it.skip("(setConfig) sets the config by admin", async function () {
    const setConfigIx = programClient.getSetConfigInstruction({
      config: configPda,
      admin: client.wallet,
      feeBps: 200,
    });

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(client.wallet, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([setConfigIx], tx)
    );

    const transaction = await signTransactionMessageWithSigners(
      transactionMessage
    );
    const signature = await client.sendAndConfirmTransaction(transaction, {
      commitment: "confirmed",
    });
    console.log("signature", signature);

    const config = await programClient.fetchConfig(client.rpc, configPda);
    console.log("config", config);
    expect(config.data.feeBps).to.equal(200);
    expect(config.data.admin).to.equal(client.wallet.address);
    expect(config.data.paused).to.equal(false);
  });

  it("(swap) swaps tokenA to tokenB", async function () {
    await setRpc(ANCHOR_PROVIDER_URL);
    await setWhirlpoolsConfig("solanaDevnet");
    // Token definition
    // devToken specification
    // https://everlastingsong.github.io/nebula/
    const devUSDC = {
      mint: address("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"),
      decimals: 6,
    };
    const devSAMO = {
      mint: address("Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa"),
      decimals: 9,
    };

    // WhirlpoolsConfig account
    // devToken ecosystem / Orca Whirlpools
    const DEVNET_WHIRLPOOLS_CONFIG = address(
      "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"
    );
    const whirlpoolConfigAddress = address(DEVNET_WHIRLPOOLS_CONFIG.toString());

    // Get devSAMO/devUSDC whirlpool
    // Whirlpools are identified by 5 elements (Program, Config, mint address of the 1st token,
    // mint address of the 2nd token, tick spacing), similar to the 5 column compound primary key in DB
    const tickSpacing = 64;
    const [whirlpoolPda] = await getWhirlpoolAddress(
      whirlpoolConfigAddress,
      devSAMO.mint,
      devUSDC.mint,
      tickSpacing
    );
    console.log("whirlpoolPda:", whirlpoolPda);

    // Swap 1 devUSDC for devSAMO
    const amountIn = BigInt(100_000);

    // Obtain swap estimation (run simulation)
    const { quote, callback: sendTx } = await swap(
      // Input token and amount
      {
        mint: devUSDC.mint,
        inputAmount: amountIn, // swap 0.1 devUSDC to devSAMO
      },
      whirlpoolPda,
      // Acceptable slippage (100bps = 1%)
      100 // 100 bps = 1%
    );

    // Output the quote
    console.log("Quote:");
    console.log("  - Amount of tokens to pay:", quote.tokenIn);
    console.log(
      "  - Minimum amount of tokens to receive with maximum slippage:",
      quote.tokenMinOut
    );
    console.log("  - Estimated tokens to receive:");
    console.log("      Based on the price at the time of the quote");
    console.log("      Without slippage consideration:", quote.tokenEstOut);
    console.log("  - Trade fee (bps):", quote.tradeFee);

    // Send the transaction using action
    const swapSignature = await sendTx();
    console.log("swapSignature:", swapSignature);

    // const feeVault = await findAssociatedTokenPda({
    //   mint: tokenAMint,
    //   owner: client.wallet.address,
    //   tokenProgram: address(TOKEN_PROGRAM_ID.toString()),
    // });
    // console.log("feeVault", feeVault);
    // console.log("wallet", client.wallet.address);
    // const swapIx = programClient.getRouteInstruction({
    //   config: configPda,
    //   feeVault: feeVault[0],
    //   legs: [],
    //   userDestination: tokenBMint,
    //   userSource: tokenAMint,
    //   userAuthority: client.wallet,
    //   userMaxIn: 1000000000n,
    //   userMinOut: 1000000000n,
    // });

    // try {
    //   const transactionMessage = pipe(
    //     createTransactionMessage({ version: 0 }),
    //     (tx) => setTransactionMessageFeePayerSigner(client.wallet, tx),
    //     (tx) =>
    //       setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    //     (tx) => appendTransactionMessageInstructions([swapIx], tx)
    //   );

    //   const transaction = await signTransactionMessageWithSigners(
    //     transactionMessage
    //   );
    //   const signature = await client.sendAndConfirmTransaction(transaction, {
    //     commitment: "confirmed",
    //   });
    //   console.log("signature", signature);
    // } catch (error) {
    //   console.log("error", error);
    // }
  });
});
