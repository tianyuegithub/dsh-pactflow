import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { launchdUnit, systemdUnit } from '../bin/generate-service.mjs'

describe('PactFlow user service generator', () => {
  it('emits launchd and systemd units without environment or credential values', () => {
    const launchd = launchdUnit({ dsh: '/opt/dsh/bin/dsh', profile: 'web', logDir: '/var/log/dsh' })
    expect(launchd).toContain('<string>/opt/dsh/bin/dsh</string>')
    expect(launchd).toContain('<string>--no-open</string>')
    expect(launchd).toContain('/var/log/dsh/pactflow-web-error.log')
    const systemd = systemdUnit({ dsh: '/opt/dsh/bin/dsh', profile: 'web' })
    expect(systemd).toContain('ExecStart="/opt/dsh/bin/dsh" --profile "web" --no-open')
    expect(`${launchd}\n${systemd}`).not.toMatch(/API_KEY|TOKEN|PASSWORD|SECRET/)
  })

  it('executes through the package-manager bin symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pactflow-service-bin-'))
    try {
      const command = join(root, 'dsh-pactflow-service')
      symlinkSync(join(process.cwd(), 'packages/dsh-pactflow/bin/generate-service.mjs'), command)
      const output = execFileSync(command, [
        '--platform', 'systemd', '--dsh', '/opt/dsh/bin/dsh', '--profile', 'web',
      ], { encoding: 'utf8' })
      expect(output).toContain('ExecStart="/opt/dsh/bin/dsh" --profile "web" --no-open')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
