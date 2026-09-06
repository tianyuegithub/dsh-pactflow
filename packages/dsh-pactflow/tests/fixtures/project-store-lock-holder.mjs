import { PactFlowWorkspaceProjectStore } from '../../lib/types/workspace-project.js'

process.once('message', async ({ path }) => {
  try {
    await new PactFlowWorkspaceProjectStore(path).withLock(async () => {
      process.send({ locked: true })
      await new Promise(() => {})
    })
  } catch {
    process.send({ failed: true })
  }
})
process.send({ ready: true })
