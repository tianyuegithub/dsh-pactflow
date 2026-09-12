import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { WorkerBridgeAnswer } from '../worker-interaction-types.ts'
export const INTERACTION_SIGNING_REF = 'PACTFLOW_WORKER_INTERACTION_SIGNING_KEY'
export function signWorkerAnswer(answer: Omit<WorkerBridgeAnswer, 'signature'>, privateKey: string): WorkerBridgeAnswer {
  return { ...answer, signature: sign(null, Buffer.from(JSON.stringify(answer)), createPrivateKey(privateKey)).toString('base64') }
}
/** Private key stays in the Host credential provider; Pods receive only its public key. */
export class WorkerInteractionSigner {
  private preparing: Promise<string> | undefined
  constructor(private readonly credentials: () => CredentialProvider | undefined) {}
  publicKey(): Promise<string> {
    if (this.preparing) return this.preparing
    this.preparing = this.prepare().finally(() => { this.preparing = undefined })
    return this.preparing
  }
  private async prepare(): Promise<string> {
    const provider = this.credentials()
    if (!provider) throw new Error('交互签名需要宿主凭证服务')
    let key = (await provider.resolve(credentialRef(INTERACTION_SIGNING_REF)))?.value
    if (!key) {
      const pair = generateKeyPairSync('ed25519')
      key = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
      await provider.set(credentialRef(INTERACTION_SIGNING_REF), key)
      if ((await provider.resolve(credentialRef(INTERACTION_SIGNING_REF)))?.value !== key) throw new Error('交互签名密钥未可靠保存')
    }
    return createPublicKey(createPrivateKey(key)).export({ type: 'spki', format: 'pem' }).toString()
  }
  async sign(answer: Omit<WorkerBridgeAnswer, 'signature'>, expectedPublicKey: string): Promise<WorkerBridgeAnswer> {
    const key = (await this.credentials()?.resolve(credentialRef(INTERACTION_SIGNING_REF)))?.value
    if (!key || createPublicKey(createPrivateKey(key)).export({ type: 'spki', format: 'pem' }).toString() !== expectedPublicKey) throw new Error('原执行器签名身份已不可用，不能发送批准')
    return signWorkerAnswer(answer, key)
  }
}
