import { getContractSubscriptionsUniqueChainIds } from "../../shared/db/contract-subscriptions/get-contract-subscriptions";
import {
  INDEXER_REGISTRY,
  addChainIndexer,
  removeChainIndexer,
} from "../indexers/chain-indexer-registry";

export const manageChainIndexers = async () => {
  const chainIdsToIndex = await getContractSubscriptionsUniqueChainIds();

  for (const chainId of chainIdsToIndex) {
    if (!(chainId in INDEXER_REGISTRY)) {
      await addChainIndexer(chainId);
    }
  }

  for (const chainId in INDEXER_REGISTRY) {
    const chainIdNum = Number.parseInt(chainId);
    if (!chainIdsToIndex.includes(chainIdNum)) {
      await removeChainIndexer(chainIdNum);
    }
  }
};
