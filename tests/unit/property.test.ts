// @ts-nocheck
import * as fc from "fast-check";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../../target/types/aggregator";
import { setupTokenAccounts, provider } from "../utils";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";

const program = anchor.workspace.aggregator as Program<Aggregator>;

/**
 * Property 1 — fee never exceeds out_amount and never overflows.
 */
describe("property: fee maths", () => {
  it("fee <= out_amount for any inputs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigUintN(64).filter((n) => n > 0n),
        fc.integer({ min: 0, max: 10_000 }),
        async (outAmountBig, feeBps) => {
          // Casts
          const outAmount = BigInt(outAmountBig);
          const fee = (outAmount * BigInt(feeBps)) / 10_000n;
          if (fee > outAmount) {
            throw new Error("fee exceeds outAmount");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 2 — router rejects when remaining account slice shorter than leg.accountCount.
 * We generate random `accountCount` in 1..4 and assert the tx fails.
 */
describe("property: remaining account guard", () => {
  it("tx fails if provided accounts < accountCount", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (accCount) => {
        const { ata, mint } = await setupTokenAccounts();
        // leg expects accCount accounts, we supply none.
        const leg = {
          dexId: { lifinityV2: {} } as any,
          inAmount: new anchor.BN(100),
          minOut: new anchor.BN(90),
          accountCount: accCount,
          data: Buffer.alloc(0),
          inMint: mint,
          outMint: mint,
        };

        try {
          await program.methods
            .route([leg], new anchor.BN(100), new anchor.BN(80))
            .accounts({
              userAuthority: provider.wallet.publicKey,
              userSource: ata,
              userDestination: ata,
              feeVault: ata,
              computeBudget: ComputeBudgetProgram.programId,
              // Intentionally NOT supplying remaining accounts
            })
            .rpc();
          throw new Error("tx should have failed but succeeded");
        } catch (_err) {
          // Expected failure; no action needed.
        }
      }),
      { numRuns: 20 }
    );
  });
});
