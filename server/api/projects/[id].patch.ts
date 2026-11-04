import type { Override } from '../../utils/scanProjects'
import { saveOverride } from '../../utils/scanProjects'

/** Local-only: stores per-project edits (title, description, demo link, tags, hidden) in data/overrides.local.json */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'Missing project id' })
  const body = await readBody<Override>(event)
  try {
    await saveOverride(id, body ?? {})
  }
  catch (e) {
    throw createError({ statusCode: 400, statusMessage: (e as Error).message })
  }
  return { ok: true }
})
