import type { Address, PublicClient } from 'viem'
import { safeAbi } from './abi'
import { normalizeSignatureV, recoverSigner } from './safe'
import { loadPending, mergeSignature, type PendingTx } from './storage'
import type { SignatureShare } from './share'

export type ImportedSignature = {
  list: PendingTx[]
  owner: Address
  safe: Address
  label: string
}

/**
 * Add a single out-of-band signature (or on behalf of an owner) to a queued
 * transaction. The signature is verified against the Safe's owner set before
 * it is stored, so a forged or wrong-safe signature is rejected.
 */
export async function importSignatureShare(
  publicClient: PublicClient,
  share: SignatureShare,
): Promise<ImportedSignature> {
  const item = loadPending().find((p) => p.id.toLowerCase() === share.id.toLowerCase())
  if (!item) {
    throw new Error('No queued transaction matches this signature (SafeTx hash not found).')
  }

  const owners = await publicClient.readContract({
    address: item.safe,
    abi: safeAbi,
    functionName: 'getOwners',
  })

  const signature = normalizeSignatureV(share.signature)
  const signer = await recoverSigner(item.id, signature)
  if (!owners.some((owner) => owner.toLowerCase() === signer.toLowerCase())) {
    throw new Error(`The signature recovers ${signer}, which is not an owner of this Safe.`)
  }
  if (signer.toLowerCase() !== share.owner.toLowerCase()) {
    throw new Error('The signature does not match the owner it claims to be from.')
  }

  const list = mergeSignature(item.id, signer, signature)
  return { list, owner: signer, safe: item.safe, label: item.label }
}
