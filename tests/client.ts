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
} from "@solana/kit";
import { ANCHOR_PROVIDER_URL } from "./utils";
import { setPayerFromBytes } from "@orca-so/whirlpools";
import secret from "../wallet.json";

export type Client = {
  rpc: Rpc<SolanaRpcApi>;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
  wallet: TransactionSigner & MessageSigner;
  sendAndConfirmTransaction: ReturnType<
    typeof sendAndConfirmTransactionFactory
  >;
  airdrop: ReturnType<typeof airdropFactory>;
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
    };
  }
  return client;
}
