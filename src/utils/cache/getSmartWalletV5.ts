import { smartWallet, type Account } from "thirdweb/wallets";
import { getAccount } from "../account";
import { thirdwebClient } from "../sdk";

import { getContract, readContract, type Address, type Chain } from "thirdweb";

export const smartWalletsCache = new Map<string, Account>();

interface SmartWalletParams {
  chain: Chain;
  accountAddress: Address;
  from: Address;
  accountFactoryAddress?: Address;
}

export const getSmartWalletV5 = async ({
  chain,
  accountAddress,
  from,
  accountFactoryAddress,
}: SmartWalletParams) => {
  const cacheKey = `${chain.id}-${accountAddress}-${from}`;
  const cachedWallet = smartWalletsCache.get(cacheKey);

  if (cachedWallet) {
    return cachedWallet;
  }

  //  Resolve Smart-Account Contract
  const smartAccountContract = getContract({
    client: thirdwebClient,
    chain,
    address: accountAddress as Address,
  });

  // Resolve Factory Contract Address from Smart-Account Contract
  if (!accountFactoryAddress) {
    accountFactoryAddress = (await readContract({
      contract: smartAccountContract,
      method: "function factory() view returns (address)",
      params: [],
    })) as Address;
  }

  // EOA Account
  const account = await getAccount({
    chainId: chain.id,
    from,
  });

  // Smart Account using the resolved Factory Contract Address
  const smartAccount = await smartWallet({
    chain,
    sponsorGas: true,
    factoryAddress: accountFactoryAddress,
  }).connect({
    client: thirdwebClient,
    personalAccount: account,
  });

  smartWalletsCache.set(cacheKey, smartAccount);
  return smartAccount;
};
