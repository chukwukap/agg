import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";
import {
  buildDummyLeg,
  ensureTestConfig,
  setupTokenAccounts,
  provider,
} from "./utils";
import { expect } from "chai";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";

/**
 * Security-focused fuzz test for adapter owner whitelisting.
 * Ensures that only whitelisted program IDs are accepted for each DEX variant.
 */
const program = anchor.workspace.aggregator as Program<Aggregator>;

/**
 * Helper to build a valid Anchor enum for the dexId field.
 * This ensures the enum is strictly typed for Anchor's IDL expectations.
 */
function dexIdEnum(
  variant:
    | "lifinityV2"
    | "orcaWhirlpool"
    | "solarCp"
    | "solarClmm"
    | "invariant"
) {
  // Each enum variant must be an object with only the variant key and an empty object as value,
  // and all other variants must be explicitly set to undefined (never) for strict typing.
  switch (variant) {
    case "lifinityV2":
      return { lifinityV2: {} } as {
        lifinityV2: Record<string, never>;
        orcaWhirlpool?: never;
        solarCp?: never;
        solarClmm?: never;
        invariant?: never;
      };
    case "orcaWhirlpool":
      return { orcaWhirlpool: {} } as {
        lifinityV2?: never;
        orcaWhirlpool: Record<string, never>;
        solarCp?: never;
        solarClmm?: never;
        invariant?: never;
      };
    case "solarCp":
      return { solarCp: {} } as {
        lifinityV2?: never;
        orcaWhirlpool?: never;
        solarCp: Record<string, never>;
        solarClmm?: never;
        invariant?: never;
      };
    case "solarClmm":
      return { solarClmm: {} } as {
        lifinityV2?: never;
        orcaWhirlpool?: never;
        solarCp?: never;
        solarClmm: Record<string, never>;
        invariant?: never;
      };
    case "invariant":
      return { invariant: {} } as {
        lifinityV2?: never;
        orcaWhirlpool?: never;
        solarCp?: never;
        solarClmm?: never;
        invariant: Record<string, never>;
      };
    default:
      throw new Error("Unknown DEX variant");
  }
}

describe("fuzz: adapter owner whitelist", function () {
  let mint: PublicKey;
  let ata: PublicKey;

  before("setup token accounts", async function () {
    const res = await setupTokenAccounts();
    mint = res.mint;
    ata = res.ata;
    await ensureTestConfig(mint);
  });

  // List of DEX enum variant names as strings
  const dexVariantNames = [
    "lifinityV2",
    "orcaWhirlpool",
    "solarCp",
    "solarClmm",
    "invariant",
  ] as const;

  dexVariantNames.forEach((variant) => {
    it(`rejects foreign owner for ${variant}`, async function () {
      // Build a leg with the correct enum encoding for dexId
      const leg = {
        ...buildDummyLeg(mint, 1000n, 900n),
        dexId: dexIdEnum(variant),
        accountCount: 1,
      };
      const rogueAcc = anchor.web3.Keypair.generate();
      await provider.connection.requestAirdrop(
        rogueAcc.publicKey,
        1_000_000_000
      );

      // Security: Use try/catch to assert on error, as .rejects does not exist on Chai's expect
      let errorCaught = false;
      try {
        await program.methods
          .route([leg], new BN(2000), new BN(850))
          .accounts({
            userAuthority: provider.wallet.publicKey,
            userSource: ata,
            userDestination: ata,
            feeVault: ata,
            computeBudget: ComputeBudgetProgram.programId,
          })
          .remainingAccounts([
            { pubkey: rogueAcc.publicKey, isSigner: false, isWritable: false },
          ])
          .rpc();
      } catch (err: any) {
        errorCaught = true;
        // Security: Ensure the error is an AnchorError or a generic error
        expect(err).to.be.instanceOf(Error);
      }
      expect(
        errorCaught,
        `Expected route to fail for foreign owner on ${variant}`
      ).to.be.true;
    });
  });
});
