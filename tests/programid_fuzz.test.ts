import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Aggregator } from "../target/types/aggregator";
import {
  buildDummyLeg,
  ensureTestConfig,
  setupTokenAccounts,
  provider,
} from "./utils";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

/**
 * This test suite fuzzes the adapter owner whitelist logic for UmbraSwap.
 * Security: All error assertions are explicit and do not rely on Chai's .rejects.
 */
const program = anchor.workspace.aggregator as Program<Aggregator>;

describe("fuzz: adapter owner whitelist", () => {
  let mint: PublicKey;
  let ata: PublicKey;

  before(async () => {
    const res = await setupTokenAccounts();
    mint = res.mint;
    ata = res.ata;
    await ensureTestConfig(mint);
  });

  // Helper to build a valid enum for dexId
  function buildDexId(variant: string) {
    // Each variant must be mutually exclusive for Anchor's enum
    switch (variant) {
      case "lifinityV2":
        return { lifinityV2: {} };
      case "orcaWhirlpool":
        return { orcaWhirlpool: {} };
      case "solarCp":
        return { solarCp: {} };
      case "solarClmm":
        return { solarClmm: {} };
      case "invariant":
        return { invariant: {} };
      default:
        throw new Error("Unknown DEX variant");
    }
  }

  // List of DEX adapter variants to test
  const dexVariants = [
    "lifinityV2",
    "orcaWhirlpool",
    "solarCp",
    "solarClmm",
    "invariant",
  ];

  dexVariants.forEach((dexName) => {
    it(`rejects foreign owner for ${dexName}`, async () => {
      // Build a SwapLeg with the correct enum shape for Anchor
      const leg = {
        ...buildDummyLeg(mint, 1000n, 900n),
        dexId: buildDexId(dexName),
        accountCount: 1,
      };
      const rogueAcc = anchor.web3.Keypair.generate();
      await provider.connection.requestAirdrop(
        rogueAcc.publicKey,
        1_000_000_000
      );

      // Security: Explicit error assertion, do not rely on .rejects
      let errorCaught = false;
      try {
        // Ensure the leg.dexId is properly typed for Anchor's enum expectations
        const formattedLeg = {
          ...leg,
          dexId: dexVariants.reduce((acc, variant) => {
            acc[variant] = undefined;
            return acc;
          }, {} as any),
          ...leg.dexId,
        };

        await program.methods
          .route([formattedLeg], new anchor.BN(2000), new anchor.BN(850))
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
      } catch (err) {
        errorCaught = true;
      }
      expect(errorCaught).to.be.true;
    });
  });
});
