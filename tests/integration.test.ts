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
import * as utils from "./utils";
import {
  setRpc,
  setWhirlpoolsConfig,
  swapInstructions,
} from "@orca-so/whirlpools";
import { getWhirlpoolAddress } from "@orca-so/whirlpools-client";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";

describe("integration: router behaviour (devnet)", function () {
  this.timeout(20000); // allow 20s for on-chain pool bootstrap
  let client: Client;
  let configPda: Address;
  let latestBlockhash: {
    blockhash: Blockhash;
    lastValidBlockHeight: bigint;
  };

  before("setup token accounts (devnet)", async function () {
    client = await createClient();

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
    await setRpc(utils.ANCHOR_PROVIDER_URL);
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
    const { quote, instructions } = await swapInstructions(
      client.rpc,
      {
        mint: devUSDC.mint,
        inputAmount: amountIn, // swap 0.1 devUSDC to devSAMO
      },
      whirlpoolPda,
      // Acceptable slippage (100bps = 1%)
      100 // 100 bps = 1%
    );
    // 1) Build the Orca swap instruction using the Whirlpool kit (already done)
    const orcaSwapIx = instructions[instructions.length - 1]; // has { programAddress, accounts[], data }
    const orcaProgram = orcaSwapIx.programAddress; // Whirlpool program id (must be included as an AccountMeta)
    const orcaMetas = orcaSwapIx.accounts.map((meta) =>
      meta.address === SYSTEM_PROGRAM_ADDRESS
        ? {
            ...meta,
            address: client.wallet.address,
            signer: client.wallet,
          }
        : meta
    );

    console.log("orcaSwapIx", JSON.stringify(orcaSwapIx, null, 2));

    // 2) Build the SwapLeg that the router understands
    // COUNT MUST MATCH WHAT YOU APPEND AS REMAINING ACCOUNTS FOR THIS LEG
    // If your adapter expects [programId, ...allOrcaAccounts], include +1 for program id
    const orcaRemainingForLeg = [
      ...orcaMetas,
      {
        address: orcaProgram,
        role: 0,
      },
    ];

    const orcaSwapLeg: programClient.SwapLeg = {
      dexId: programClient.DexId.OrcaWhirlpool,
      inAmount: amountIn,
      minOut: quote.tokenMinOut,
      accountCount: orcaRemainingForLeg.length, // <-- IMPORTANT
      data: orcaSwapIx.data, // raw CPI payload for Orca
      inMint: devUSDC.mint,
      outMint: devSAMO.mint,
    };

    // User token accounts (ATAs) for src/dest mints owned by your wallet
    // devUSDC
    const userSrcAta = address("BtdsPcsJWT2nJa2xzsEtqEF8w89cCavFGC64wkAcvTUz");
    // devSAMO my token account
    const userDstAta = address("9hVzz5jgLhQNEaWjVY4Gb7TY1o1H5stL89e5NkntkbBM");
    // Fetch config to know who the admin is (fee vault must be admin’s ATA for OUT mint)
    const cfg = await programClient.fetchConfig(client.rpc, configPda); // or your generated getter
    const feeVaultAta = await client.getOrCreateAta(
      client.wallet,
      devSAMO.mint,
      cfg.address
    );
    // Base route instruction (declared accounts only)
    let routeIx = utils.getRouteInstruction(
      {
        config: configPda,
        feeVault: feeVaultAta, // admin’s ATA for final out mint
        legs: [orcaSwapLeg], // your single-leg route
        userDestination: userDstAta, // <-- token account, not mint
        userSource: userSrcAta, // <-- token account, not mint
        userAuthority: client.wallet,
        userMaxIn: quote.tokenIn,
        userMinOut: quote.tokenMinOut,
      },
      orcaRemainingForLeg
    );
    // console.log("routeIx accounts", JSON.stringify(routeIx.accounts));

    try {
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(client.wallet, tx),
        (tx) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => appendTransactionMessageInstructions([routeIx], tx)
      );

      const transaction = await signTransactionMessageWithSigners(
        transactionMessage
      );
      const signature = await client.sendAndConfirmTransaction(transaction, {
        commitment: "confirmed",
      });
      console.log("signature", signature);
    } catch (error) {
      console.log("error", error);
    }
  });
});
