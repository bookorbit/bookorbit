import { syncCrowdinSource } from './sync-crowdin-translations.mjs'

syncCrowdinSource({
  token: process.env.CROWDIN_TOKEN,
  projectId: process.env.CROWDIN_PROJECT_ID || undefined,
}).catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
