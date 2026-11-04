import { loadProjects } from '../utils/scanProjects'

/** Local-only: reads sibling project folders on this machine. Not available in static `nuxt generate` builds. */
export default defineEventHandler(async (event) => {
  const { refresh } = getQuery(event)
  return loadProjects(refresh === '1')
})
