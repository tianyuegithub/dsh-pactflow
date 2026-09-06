import { PactFlowWorkspaceProjectStore } from '../../lib/types/workspace-project.js'

process.once('message', async ({ path, expectedRevision, config }) => {
  try {
    const accepted = await new PactFlowWorkspaceProjectStore(path).putIfRevision(expectedRevision, config)
    process.send({ accepted }, () => process.disconnect())
  } catch (error) {
    process.send({ error: error instanceof Error ? error.message : 'write failed' }, () => process.disconnect())
  }
})
process.send({ ready: true })
