import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as FormData from 'form-data';
import * as fs from 'fs';
import {
  ApiNetworkProvider,
  NonFungibleTokenOfAccountOnNetwork,
  ProxyNetworkProvider,
} from '@multiversx/sdk-network-providers';
import {
  AbiRegistry,
  Account,
  Address,
  Interaction,
  SmartContract,
  Transaction,
  TransactionWatcher,
} from '@multiversx/sdk-core/out';
import { parseUserKey, UserSigner } from '@multiversx/sdk-wallet';

@Injectable()
export class MultiversxService {
  private readonly mvxApi: ApiNetworkProvider;
  private readonly mvxProxy: ProxyNetworkProvider;
  private readonly backendAccountPemContent: string;
  private readonly escrowContractAddress: string;
  private readonly escrowContractAbi: AbiRegistry;

  private readonly networkCfg: {
    chain: '1' | 'D' | 'T';
  };
  private backendAccount: Account;

  constructor(private configService: ConfigService) {
    const mvxApiUrl = this.configService.get('MVX_API_URL');
    const mvxProxyUrl = this.configService.get('MVX_PROXY_URL');
    const pemPath = this.configService.get('MVX_PEM_PATH');
    const chainId = this.configService.get('MVX_CHAIN_ID');
    const escrowContractAddress = this.configService.get(
      'MVX_ESCROW_CONTRACT_ADDRESS',
    );
    const escrowContractAbiPath = this.configService.get(
      'MVX_ESCROW_CONTRACT_ABI_PATH',
    );

    this.escrowContractAbi = AbiRegistry.create(
      JSON.parse(fs.readFileSync(escrowContractAbiPath, 'utf8')),
    );

    this.backendAccountPemContent = fs.readFileSync(pemPath, 'utf8');
    this.mvxApi = new ApiNetworkProvider(mvxApiUrl);
    this.mvxProxy = new ProxyNetworkProvider(mvxProxyUrl);
    this.networkCfg = {
      chain: chainId as '1' | 'D' | 'T',
    };
    this.escrowContractAddress = escrowContractAddress;
  }

  async updateInternalAccount() {
    if (this.backendAccount) {
      return;
    }

    const userKey = parseUserKey(this.backendAccountPemContent);
    const address = userKey.generatePublicKey().toAddress();

    const account = new Account(address);
    const apiAccount = await this.mvxApi.getAccount(address);
    account.update(apiAccount);

    this.backendAccount = account;
  }

  async signAndSendTx(txInteraction: Interaction) {
    let tx = txInteraction
      .withChainID(this.networkCfg.chain)
      .withSender(this.backendAccount.address)
      .buildTransaction();

    tx.setNonce(this.backendAccount.getNonceThenIncrement());
    let txResult = await this.signAndSendExplicit(tx);

    return (
      !txResult.status.isFailed() &&
      !txResult.status.isInvalid() &&
      !txResult.status.isPending()
    );
  }

  async signAndSendExplicit(tx: Transaction) {
    const signer = UserSigner.fromPem(this.backendAccountPemContent);
    const serializedTransaction = tx.serializeForSigning();
    const signature = await signer.sign(serializedTransaction);
    tx.applySignature(signature);
    await this.mvxProxy.sendTransaction(tx);
    console.log(`Transaction sent. Tx hash: ${tx.getHash().toString()}`);
    const watcher = new TransactionWatcher(this.mvxProxy);
    const transactionOnNetwork = await watcher.awaitCompleted(tx);
    return transactionOnNetwork;
  }

  async getNftByIdentifier(
    nftIdentifier: string,
  ): Promise<NonFungibleTokenOfAccountOnNetwork> {
    const idParts = nftIdentifier.split(':');
    const identifier = `${idParts[0]}-${idParts[1]}`;
    const nonce = parseInt(idParts[2]);

    const nft = await this.mvxApi.getNonFungibleToken(identifier, nonce);
    return nft;
  }

  async getUpdateInteraction(
    nftIdentifier: string,
    newMetadataUrl: string,
  ): Promise<Interaction> {
    const newMetadataCID = newMetadataUrl.split('/').pop();
    const nftOnNetwork = await this.getNftByIdentifier(nftIdentifier);
    const previousAttributes = nftOnNetwork.attributes.toString('utf8');
    // tags:xArtists,AIMegaWaveHackathon;metadata:bafkreibngetnjgfzrq2ovxw7ek745rk6vz34y23yxjau3qgpxcwltvdq7a
    const newAttributes =
      previousAttributes
        .split(';')
        .filter((attr) => !attr.includes('metadata'))
        .join(';') + `;metadata=${newMetadataCID}`;

    const contract = new SmartContract({
      address: new Address(this.escrowContractAddress),
      abi: this.escrowContractAbi,
    });

    return contract.methods
      .update([
        nftOnNetwork.nonce,
        nftOnNetwork.name,
        nftOnNetwork.royalties,
        newAttributes,
        nftOnNetwork.assets[0],
        newMetadataUrl,
      ])
      .withGasLimit(20_000_000);
  }

  async sendUpdateTx(nftIdentifier: string, newMetadataUrl: string) {
    const interaction = await this.getUpdateInteraction(
      nftIdentifier,
      newMetadataUrl,
    );
    return this.signAndSendTx(interaction);
  }
}

// export interface ApiNft {
//   identifier: string;
//   collection: string;
//   attributes: string;
//   nonce: number;
//   type: string;
//   subType: string;
//   name: string;
//   creator: string;
//   royalties: number;
//   uris: string[];
//   url: string;
//   media: ApiNftMedia[];
//   isWhitelistedStorage: boolean;
//   tags: string[];
//   metadata: ApiNftMetadata;
//   balance: string;
//   ticker: string;
//   unstakingTimestamp?: number;
// }

// export interface ApiNftMedia {
//   url: string;
//   originalUrl: string;
//   thumbnailUrl: string;
//   fileType: string;
//   fileSize: number;
// }

// export interface ApiNftMetadata {
//   title?: string;
//   attributes?: NftAttribute[];
//   description?: string;
// }

// export interface NftAttribute {
//   trait_type: string;
//   value: string;
// }
