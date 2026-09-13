import { describe, expect, it } from 'vitest'
import { assertArtifactUploadSafe, PactFlowUploadGateError } from '../src/worker/redact.ts'

describe('PactFlow artifact upload redaction gate', () => {
  it('accepts plain technical content', () => {
    expect(() => assertArtifactUploadSafe('build passed; 42 tests green\nsee /tmp/build.log for details')).not.toThrow()
  })

  it('rejects known host-issued credential values', () => {
    const known = ['super-secret-host-issued-value']
    expect(() => assertArtifactUploadSafe('token: super-secret-host-issued-value', known)).toThrow(PactFlowUploadGateError)
    expect(() => assertArtifactUploadSafe('unrelated text', known)).not.toThrow()
  })

  it('rejects generic credential forms', () => {
    expect(() => assertArtifactUploadSafe('-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----')).toThrow(/private key/)
    expect(() => assertArtifactUploadSafe('authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toThrow(/Bearer\/Basic/)
    expect(() => assertArtifactUploadSafe('see https://user:hunter2@example.com/repo.git')).toThrow(/userinfo/)
    expect(() => assertArtifactUploadSafe('api_key: "abc123def456"')).toThrow(/key\/value/)
  })

  it('allows benign assignments and placeholders', () => {
    expect(() => assertArtifactUploadSafe('GITHUB_TOKEN="" is empty here')).not.toThrow()
    expect(() => assertArtifactUploadSafe('use ${GITHUB_TOKEN} from the environment')).not.toThrow()
    expect(() => assertArtifactUploadSafe('set password to ******** in the docs')).not.toThrow()
    expect(() => assertArtifactUploadSafe('the tokens table lists counts only')).not.toThrow()
  })

  it('fails closed when the scanner itself throws', () => {
    const boom = new Error('scanner exploded')
    const gate = (): void => assertArtifactUploadSafe('plain content', [], () => { throw boom })
    expect(gate).toThrow(PactFlowUploadGateError)
    expect(gate).toThrow(/scanner itself failed/)
    try {
      gate()
      expect.unreachable('gate must throw on scanner failure')
    } catch (error) {
      expect((error as PactFlowUploadGateError).cause).toBe(boom)
    }
  })

  it('rejects via a thrown gate error type, never a silent pass', () => {
    try {
      assertArtifactUploadSafe('password=hunter2secret')
      expect.unreachable('gate must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PactFlowUploadGateError)
      expect((error as PactFlowUploadGateError).reason).toContain('key/value')
    }
  })
})
