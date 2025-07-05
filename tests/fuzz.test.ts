import * as fc from "fast-check";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";
import {
  setupTokenAccounts,
  provider,
  ensureTestConfig,
  buildDummyLeg,
  getTokenBalance,
} from "./utils";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { expect } from "chai";

const program = anchor.workspace.aggregator as Program<Aggregator>;

describe.skip("fuzz: route guard matrix", function () {
  let mint: anchor.web3.PublicKey;
  let ata: anchor.web3.PublicKey;

  before("setup token accounts", async function () {
    const res = await setupTokenAccounts(10_000_000n);
    mint = res.mint;
    ata = res.ata;
    await ensureTestConfig(mint);
  });

  /** Positive property: when hints respect guards tx succeeds */
  it("route succeeds when guards satisfied", async function () {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.array(fc.integer({ min: 1000, max: 20_000 }), {
          minLength: 1,
          maxLength: 3,
        }),
        async (legCount, amounts) => {
          const legs = amounts
            .slice(0, legCount)
            .map((amt) =>
              buildDummyLeg(mint, BigInt(amt), BigInt(Math.floor(amt * 0.8)))
            );
          const totalIn = amounts.slice(0, legCount).reduce((a, b) => a + b, 0);
          const totalOut = Math.floor(totalIn * 0.8);

          await program.methods
            .route(
              legs,
              new anchor.BN(totalIn + 1000),
              new anchor.BN(Math.floor(totalOut * 0.95))
            )
            .accounts({
              userAuthority: provider.wallet.publicKey,
              userSource: ata,
              userDestination: ata,
              feeVault: ata,
              computeBudget: ComputeBudgetProgram.programId,
            })
            .preInstructions([
              ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
            ])
            .rpc();
        }
      ),
      { numRuns: 15 }
    );
  });

  /** Negative: overspend triggers failure */
  it("overspend fails", async function () {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 5000, max: 20_000 }), async (amt) => {
        const leg = buildDummyLeg(
          mint,
          BigInt(amt),
          BigInt(Math.floor(amt * 0.9))
        );
        // Security: Use try/catch to assert on error, as .rejects does not exist on Chai's expect
        let errorCaught = false;
        try {
          await program.methods
            .route(
              [leg],
              new anchor.BN(amt - 100),
              new anchor.BN(Math.floor(amt * 0.8))
            )
            .accounts({
              userAuthority: provider.wallet.publicKey,
              userSource: ata,
              userDestination: ata,
              feeVault: ata,
              computeBudget: ComputeBudgetProgram.programId,
            })
            .rpc();
        } catch (err: any) {
          errorCaught = true;
          // Optionally, check for AnchorError or error message
          expect(err).to.be.instanceOf(Error);
        }
        expect(errorCaught, "Expected overspend to throw").to.be.true;
      }),
      { numRuns: 10 }
    );
  });

  /** Mint continuity fuzz: introduce mismatch and expect failure */
  it("mint continuity broken fails", async function () {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1000, max: 10_000 }), async (amt) => {
        const other = await setupTokenAccounts();
        const leg1 = buildDummyLeg(
          mint,
          BigInt(amt),
          BigInt(Math.floor(amt * 0.9))
        );
        const leg2 = buildDummyLeg(
          other.mint,
          BigInt(amt),
          BigInt(Math.floor(amt * 0.8))
        );

        // Security: Use try/catch to assert on error, as .rejects does not exist on Chai's expect
        let errorCaught = false;
        try {
          await program.methods
            .route(
              [leg1, leg2],
              new anchor.BN(amt * 2 + 1000),
              new anchor.BN(Math.floor(amt * 1.5))
            )
            .accounts({
              userAuthority: provider.wallet.publicKey,
              userSource: ata,
              userDestination: ata,
              feeVault: ata,
              computeBudget: ComputeBudgetProgram.programId,
            })
            .rpc();
        } catch (err: any) {
          errorCaught = true;
          // Optionally, check for AnchorError or error message
          expect(err).to.be.instanceOf(Error);
        }
        expect(errorCaught, "Expected mint continuity break to throw").to.be
          .true;
      }),
      { numRuns: 10 }
    );
  });

  /** Fee-vault invariant */
  it("fee vault receives correct protocol fee", async function () {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10_000, max: 100_000 }),
        async (amt) => {
          const leg = buildDummyLeg(
            mint,
            BigInt(amt),
            BigInt(Math.floor(amt * 0.8))
          );

          const before = await getTokenBalance(ata);

          await program.methods
            .route(
              [leg],
              new anchor.BN(amt + 1000),
              new anchor.BN(Math.floor(amt * 0.75))
            )
            .accounts({
              userAuthority: provider.wallet.publicKey,
              userSource: ata,
              userDestination: ata,
              feeVault: ata,
              computeBudget: ComputeBudgetProgram.programId,
            })
            .rpc();

          const after = await getTokenBalance(ata);
          const deltaOut = BigInt(Math.floor(amt * 0.8));
          const expectedFee = (deltaOut * 200n) / 10_000n; // fee_bps = 200
          expect(after - before === expectedFee).to.be.true;
        }
      ),
      { numRuns: 10 }
    );
  });
});
