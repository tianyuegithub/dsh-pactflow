#!/usr/bin/env node

import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

export function launchdUnit({ dsh, profile, logDir }) {
  const label = `ai.deepseek.dsh.pactflow.${profile}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(dsh)}</string><string>--profile</string><string>${xml(profile)}</string><string>--no-open</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(`${logDir}/pactflow-web.log`)}</string>
  <key>StandardErrorPath</key><string>${xml(`${logDir}/pactflow-web-error.log`)}</string>
</dict>
</plist>
`
}

export function systemdUnit({ dsh, profile }) {
  return `[Unit]
Description=DSH PactFlow web profile
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${systemdArg(dsh)} --profile ${systemdArg(profile)} --no-open
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=default.target
`
}

function argumentsFrom(argv) {
  argv = argv.filter(value => value !== '--')
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === undefined || value === undefined || !key.startsWith('--')) usage()
    values.set(key.slice(2), value)
  }
  const platform = values.get('platform')
  const dsh = values.get('dsh')
  const profile = values.get('profile') ?? 'web'
  const logDir = values.get('log-dir')
  if ((platform !== 'launchd' && platform !== 'systemd') || dsh === undefined || !isAbsolute(dsh)
    || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(profile)
    || (platform === 'launchd' && (logDir === undefined || !isAbsolute(logDir)))) usage()
  return { platform, dsh, profile, logDir }
}

function usage() {
  process.stderr.write('usage: dsh-pactflow-service --platform launchd|systemd --dsh /absolute/dsh [--profile web] [--log-dir /absolute/logs]\n')
  process.exit(2)
}

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function systemdArg(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = argumentsFrom(process.argv.slice(2))
  process.stdout.write(options.platform === 'launchd'
    ? launchdUnit({ dsh: options.dsh, profile: options.profile, logDir: options.logDir })
    : systemdUnit({ dsh: options.dsh, profile: options.profile }))
}
