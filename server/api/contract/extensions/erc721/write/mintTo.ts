import { Static, Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";
import { StatusCodes } from "http-status-codes";
import { getContractInstance } from "../../../../../../core/index";
import { queueTx } from "../../../../../../src/db/transactions/queueTx";
import {
  contractParamSchema,
  standardResponseSchema,
  transactionWritesResponseSchema,
} from "../../../../../helpers/sharedApiSchemas";
import { nftOrInputSchema } from "../../../../../schemas/nft";
import { web3APIOverridesForWriteRequest } from "../../../../../schemas/web3api-overrides";
import { getChainIdFromChain } from "../../../../../utilities/chain";

// INPUTS
const requestSchema = contractParamSchema;
const requestBodySchema = Type.Object({
  receiver: Type.String({
    description: "Address of the wallet to mint the NFT to",
  }),
  metadata: nftOrInputSchema,
  ...web3APIOverridesForWriteRequest.properties,
});

requestBodySchema.examples = [
  {
    receiver: "0x3EcDBF3B911d0e9052b64850693888b008e18373",
    metadata: {
      name: "My NFT",
      description: "My NFT description",
      image: "ipfs://QmciR3WLJsf2BgzTSjbG5zCxsrEQ8PqsHK7JWGWsDSNo46/nft.png",
    },
    web3api_overrides: {
      from: "0x...",
    },
  },
];

export async function erc721mintTo(fastify: FastifyInstance) {
  fastify.route<{
    Params: Static<typeof requestSchema>;
    Reply: Static<typeof transactionWritesResponseSchema>;
    Body: Static<typeof requestBodySchema>;
  }>({
    method: "POST",
    url: "/contract/:network/:contract_address/erc721/mintTo",
    schema: {
      description: "Mint an NFT to a specific wallet.",
      tags: ["ERC721"],
      operationId: "erc721_mintTo",
      params: requestSchema,
      body: requestBodySchema,
      response: {
        ...standardResponseSchema,
        [StatusCodes.OK]: transactionWritesResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { network, contract_address } = request.params;
      const { receiver, metadata, web3api_overrides } = request.body;
      const chainId = getChainIdFromChain(network);

      const contract = await getContractInstance(
        network,
        contract_address,
        web3api_overrides?.from,
      );
      const tx = await contract.erc721.mintTo.prepare(receiver, metadata);
      const queuedId = await queueTx({ tx, chainId, extension: "erc721" });
      reply.status(StatusCodes.OK).send({
        result: queuedId,
      });
    },
  });
}
