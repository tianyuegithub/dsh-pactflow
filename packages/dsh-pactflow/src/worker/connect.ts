import { connect } from 'node:net'
import { WORKER_SOCKET_PATH } from './bridge.ts'
// Kubernetes exec carries stdin/stdout. This image-owned program executes no
// user-provided commands and has no general Host API or cluster credential.
const socket = connect(WORKER_SOCKET_PATH)
socket.on('error', () => { process.stderr.write('DSH interaction endpoint unavailable\n'); process.exitCode = 42; process.stdin.destroy() })
socket.on('connect', () => { process.stdin.pipe(socket); socket.pipe(process.stdout) })
socket.on('close', () => { process.stdin.destroy() })
process.stdin.on('end', () => socket.end())
