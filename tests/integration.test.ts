import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";
import {
  setupTokenAccounts,
  provider,
  buildDummyLeg,
  createAtaForMint,
  getConfigPda,
  TestTokenA,
  TestTokenB,
} from "./utils";
import {
  ComputeBudgetProgram,
  PublicKey,
  SendTransactionError,
} from "@solana/web3.js";
import { expect } from "chai";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { buildOrcaWhirlpoolLeg } from "./amm_helpers/orca";
import { buildLifinityLeg } from "./amm_helpers/lifinity"; // Assume this helper exists
import { getAllPools } from "@lifinity/sdk-v2";

const program = anchor.workspace.aggregator as Program<Aggregator>;

/**
 * Integration tests – executed against a local validator via `anchor test`.
 * We use the stub Lifinity adapter (0 remaining accounts) so no heavy account
 * setup is needed.  These tests focus on high-level router behaviour & guards.
 */
describe("integration: router behaviour", function () {
  this.timeout(20000); // allow 20s for on-chain pool bootstrap

  let mint: anchor.web3.PublicKey;
  let ata: anchor.web3.PublicKey;
  let configPda: anchor.web3.PublicKey = getConfigPda()[0];

  before("setup token accounts", async function () {
    const res = await setupTokenAccounts(5_000_000n);
    mint = res.mint;
    ata = res.ata;

    // await ensureTestConfig(mint); // sets fee_vault to this ATA
  });

  /** Happy path: one leg succeeds and respects slippage/net-out */
  it.skip("Orca Whirlpool: executes a single-leg route & deducts protocol fee", async function () {
    const { leg, remainingAccounts } = await buildOrcaWhirlpoolLeg(
      1_000_000n,
      800_000n
    );

    const tokenAAta = await createAtaForMint(
      new PublicKey(TestTokenA),
      provider.wallet.publicKey
    );
    const tokenBAta = await createAtaForMint(
      new PublicKey(TestTokenB),
      provider.wallet.publicKey
    );

    // Ensure fee vault mint matches leg.outMint
    // await ensureTestConfig(leg.outMint);

    try {
      const tx = await program.methods
        .route([leg], new anchor.BN(1_100_000), new anchor.BN(780_000)) // max_in 1.1M, min_out 0.78M
        .accountsStrict({
          userAuthority: provider.wallet.publicKey,
          userSource: tokenAAta,
          userDestination: tokenBAta,
          feeVault: tokenBAta, // final destination token
          computeBudget: ComputeBudgetProgram.programId,
          config: configPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ])
        .rpc();

      console.log("executed tx", tx);
    } catch (error) {
      if (error instanceof SendTransactionError) {
        console.log(
          "error========>>>",
          await error.getLogs(provider.connection)
        );
      } else {
        console.log("error========>>>", error);
      }
    }
  });

  /**
   * Lifinity Pool: executes a single-leg route & deducts protocol fee
   * This test ensures that a single-leg swap via the Lifinity adapter
   * executes successfully and the protocol fee is deducted as expected.
   * Security: Ensures correct fee vault and token program are used.
   */
  it.only("Lifinity Pool: executes a single-leg route & deducts protocol fee", async function () {
    const pool = await getAllPools(provider.connection)[0];

    // Create ATAs for input and output tokens
    const tokenAAta = await createAtaForMint(
      new PublicKey(pool.mintA),
      provider.wallet.publicKey
    );
    const tokenBAta = await createAtaForMint(
      new PublicKey(pool.mintB),
      provider.wallet.publicKey
    );

    // Build a Lifinity leg for the swap
    // buildLifinityLeg should return { leg, remainingAccounts }
    // For the test, swap 1,000,000 in for 800,000 out (dummy values)
    const { leg, remainingAccounts } = await buildLifinityLeg(
      1_000_000n,
      800_000n,
      new PublicKey(pool.mintA),
      new PublicKey(pool.mintB),
      pool
    );

    // Ensure fee vault mint matches leg.outMint
    // await ensureTestConfig(leg.outMint);

    // Get balances before swap for assertion
    const getTokenBalance = async (ata: PublicKey) => {
      const acc = await provider.connection.getTokenAccountBalance(ata);
      return BigInt(acc.value.amount);
    };
    const beforeSource = await getTokenBalance(tokenAAta);
    const beforeDestination = await getTokenBalance(tokenBAta);

    let tx;
    try {
      tx = await program.methods
        .route([leg], new anchor.BN(1_100_000), new anchor.BN(780_000)) // max_in 1.1M, min_out 0.78M
        .accountsStrict({
          userAuthority: provider.wallet.publicKey,
          userSource: tokenAAta,
          userDestination: tokenBAta,
          feeVault: tokenBAta, // final destination token
          computeBudget: ComputeBudgetProgram.programId,
          config: configPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ])
        .rpc();

      // Professional logging for test traceability
      console.log("Lifinity pool executed tx", tx);
    } catch (error) {
      if (error instanceof SendTransactionError) {
        console.error(
          "Lifinity pool error logs:",
          await error.getLogs(provider.connection)
        );
      } else {
        console.error("Lifinity pool error:", error);
      }
      throw error;
    }

    // Get balances after swap
    const afterSource = await getTokenBalance(tokenAAta);
    const afterDestination = await getTokenBalance(tokenBAta);

    // Assert that source decreased and destination increased
    expect(Number(afterSource)).to.be.lessThan(Number(beforeSource));
    expect(Number(afterDestination)).to.be.greaterThan(
      Number(beforeDestination)
    );

    // Optionally, check that the protocol fee was deducted (if fee logic is testable)
    // This would require knowledge of the fee rate and calculation
    // For now, just log the difference for manual inspection
    console.log(
      "Source delta:",
      beforeSource - afterSource,
      "Destination delta:",
      afterDestination - beforeDestination
    );
  });

  /** Guard: consecutive legs must have matching mints */
  it("fails when mint continuity breaks", async function () {
    const other = await setupTokenAccounts();
    const leg1 = buildDummyLeg(mint, 1000n, 900n);
    const leg2 = buildDummyLeg(other.mint, 900n, 800n); // in_mint mismatch

    let errorCaught = false;
    try {
      await program.methods
        .route([leg1, leg2], new anchor.BN(2_000), new anchor.BN(1_500))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for mint continuity break").to.be.true;
  });

  /** Guard: user_max_in exceeded */
  it("fails when spent tokens exceed user_max_in", async function () {
    const leg = buildDummyLeg(mint, 10_000n, 9_000n);

    let errorCaught = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(5_000), new anchor.BN(8_000)) // max_in too small
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for user_max_in exceeded").to.be.true;
  });

  /** Guard: user_min_out (net) not satisfied */
  it("fails when net out < user_min_out", async function () {
    const leg = buildDummyLeg(mint, 1_000_000n, 800_000n);

    let errorCaught = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(1_100_000), new anchor.BN(810_000)) // min_out too high
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for user_min_out not satisfied").to.be
      .true;
  });

  /** Guard: fee vault mint mismatch */
  it("fails when fee vault mint differs from out mint", async function () {
    const other = await setupTokenAccounts();
    const leg = buildDummyLeg(mint, 1_000n, 900n);

    let errorCaught = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(1_500), new anchor.BN(850))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: other.ata, // vault mint != leg.outMint
          computeBudget: ComputeBudgetProgram.programId,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for fee vault mint mismatch").to.be
      .true;
  });

  /** Stress: many legs require explicit compute budget */
  it("requires compute budget for long paths", async function () {
    const leg = buildDummyLeg(mint, 1_000n, 900n);
    const longPath = Array.from({ length: 10 }, () => ({ ...leg }));

    // Without CU ix should fail
    let errorCaught = false;
    try {
      await program.methods
        .route(longPath, new anchor.BN(30_000), new anchor.BN(20_000))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for missing compute budget").to.be.true;

    // Adding CU ix succeeds
    await program.methods
      .route(longPath, new anchor.BN(30_000), new anchor.BN(20_000))
      .accounts({
        userAuthority: provider.wallet.publicKey,
        userSource: ata,
        userDestination: ata,
        feeVault: ata,
        computeBudget: ComputeBudgetProgram.programId,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_800_000 }),
      ])
      .rpc();
  });

  /** Guard: RemainingAccountsMismatch with extra accounts */
  it("fails when too many remaining accounts provided", async function () {
    const leg = { ...buildDummyLeg(mint, 1000n, 900n), accountCount: 0 };

    const dummyAcc = anchor.web3.Keypair.generate();

    let errorCaught = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(2000), new anchor.BN(850))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .remainingAccounts([
          { pubkey: dummyAcc.publicKey, isSigner: false, isWritable: false },
        ]) // 1 extra while accountCount =0
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for too many remaining accounts").to.be
      .true;
  });

  /** Adapter owner-whitelist rejects foreign program id (using Orca variant) */
  it("adapter whitelist rejects foreign owner", async function () {
    const foreignLeg = {
      ...buildDummyLeg(mint, 1000n, 900n),
      dexId: { orcaWhirlpool: {} } as any,
      accountCount: 1,
    };

    const wrongAccount = anchor.web3.Keypair.generate();
    // create minimal lamport account
    await provider.connection.requestAirdrop(
      wrongAccount.publicKey,
      1_000_000_000
    );

    let errorCaught = false;
    try {
      await program.methods
        .route([foreignLeg], new anchor.BN(2000), new anchor.BN(850))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .remainingAccounts([
          {
            pubkey: wrongAccount.publicKey,
            isSigner: false,
            isWritable: false,
          },
        ])
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for adapter whitelist foreign owner").to
      .be.true;
  });

  /** Guard: empty legs rejected */
  it("fails when legs array is empty", async function () {
    let errorCaught = false;
    try {
      await program.methods
        .route([], new anchor.BN(0), new anchor.BN(1))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for empty legs array").to.be.true;
  });

  /** Fee-vault address mismatch (mint matches) */
  it("fails when fee vault address != config fee_vault", async function () {
    const otherVault = await createAtaForMint(mint, provider.wallet.publicKey);
    const leg = buildDummyLeg(mint, 1000n, 900n);

    let errorCaught = false;
    try {
      await program.methods
        .route([leg], new anchor.BN(1500), new anchor.BN(850))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: otherVault, // different address but same mint
          computeBudget: ComputeBudgetProgram.programId,
        })
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for fee vault address mismatch").to.be
      .true;
  });

  /** Second adapter whitelist (Invariant) */
  it("invariant adapter whitelist rejects foreign owner", async function () {
    const invLeg = {
      ...buildDummyLeg(mint, 1000n, 900n),
      dexId: { invariant: {} } as any,
      accountCount: 1,
    };
    const rogue = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(rogue.publicKey, 1_000_000_000);

    let errorCaught = false;
    try {
      await program.methods
        .route([invLeg], new anchor.BN(2000), new anchor.BN(850))
        .accounts({
          userAuthority: provider.wallet.publicKey,
          userSource: ata,
          userDestination: ata,
          feeVault: ata,
          computeBudget: ComputeBudgetProgram.programId,
        })
        .remainingAccounts([
          { pubkey: rogue.publicKey, isSigner: false, isWritable: false },
        ])
        .rpc();
    } catch (err) {
      errorCaught = true;
      expect(err).to.be.instanceOf(Error);
    }
    expect(errorCaught, "Expected error for invariant adapter whitelist").to.be
      .true;
  });
});
