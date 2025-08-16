import {
  airdropFactory,
  Rpc,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  MessageSigner,
  TransactionSigner,
  SolanaRpcApi,
  RpcSubscriptions,
  SolanaRpcSubscriptionsApi,
  sendAndConfirmTransactionFactory,
  createKeyPairSignerFromBytes,
  Address,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { ANCHOR_PROVIDER_URL } from "./utils";
import { setPayerFromBytes } from "@orca-so/whirlpools";
import secret from "../wallet.json";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

export type Client = {
  rpc: Rpc<SolanaRpcApi>;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
  wallet: TransactionSigner & MessageSigner;
  sendAndConfirmTransaction: ReturnType<
    typeof sendAndConfirmTransactionFactory
  >;
  airdrop: ReturnType<typeof airdropFactory>;
  getOrCreateAta: (
    payerSigner: TransactionSigner & MessageSigner,
    mint: Address,
    ownerAddress: Address
  ) => Promise<Address>;
};

let client: Client | undefined;
export async function createClient(): Promise<Client> {
  if (!client) {
    // Create RPC objects and airdrop function.
    const rpc = createSolanaRpc(ANCHOR_PROVIDER_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(
      ANCHOR_PROVIDER_URL.replace("https://", "wss://")
    );

    await setPayerFromBytes(new Uint8Array(secret));

    const wallet = await createKeyPairSignerFromBytes(new Uint8Array(secret));
    console.log("wallet address:", wallet.address);

    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
      rpc,
      rpcSubscriptions,
    });
    const airdrop = airdropFactory({ rpc, rpcSubscriptions });

    async function getOrCreateAta(
      payerSigner: TransactionSigner & MessageSigner,
      mint: Address,
      ownerAddress: Address
    ): Promise<Address> {
      // 1) Derive ATA PDA
      const [ataPda] = await findAssociatedTokenPda({
        mint,
        owner: ownerAddress,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      // 2) Build instruction to create ATA if it does not exist
      const createAtaIx =
        await getCreateAssociatedTokenIdempotentInstructionAsync({
          payer: payerSigner,
          owner: ownerAddress,
          mint,
        });
      const latestBlockhash = (await rpc.getLatestBlockhash().send()).value;

      // 3) Build and send the transaction
      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(payerSigner, tx),
        (tx) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => appendTransactionMessageInstructions([createAtaIx], tx)
      );

      const transaction = await signTransactionMessageWithSigners(
        transactionMessage
      );
      await sendAndConfirmTransaction(transaction, {
        commitment: "confirmed",
      });

      return ataPda;
    }

    // Create a wallet with lamports.
    // const wallet = await generateKeyPairSigner();
    // await airdrop({
    //   recipientAddress: wallet.address,
    //   lamports: lamports(1_000_000_000n),
    //   commitment: "confirmed",
    // });

    // Store the client.
    client = {
      rpc,
      rpcSubscriptions,
      wallet,
      sendAndConfirmTransaction,
      airdrop,
      getOrCreateAta,
    };
  }
  return client;
}
