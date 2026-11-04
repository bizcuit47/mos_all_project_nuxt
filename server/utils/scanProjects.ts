import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type Category = 'unity' | 'nuxt' | 'web' | 'python' | 'dotnet' | 'other'
export type Visibility = 'public' | 'private' | 'local' | 'unknown'

export interface Project {
  id: string
  title: string
  category: Category
  visibility: Visibility
  description: string
  repoUrl: string | null
  demoUrl: string | null
  lastCommit: string | null
  path: string
  tags: string[]
  hidden?: boolean
}

export interface ProjectsPayload {
  scannedAt: string
  root: string
  /** Folder names seen at scan time; used to detect newly added projects. */
  folders: string[]
  skippedInaccessible: string[]
  projects: Project[]
}

/** Per-folder overrides, stored in data/overrides.local.json (gitignored). */
export interface Override {
  title?: string
  description?: string
  category?: Category
  demoUrl?: string
  tags?: string[]
  hidden?: boolean
}

const DATA_DIR = resolve(process.cwd(), 'data')
const CACHE_FILE = join(DATA_DIR, 'projects.local.json')
const OVERRIDES_FILE = join(DATA_DIR, 'overrides.local.json')

// Folders that are not "my" projects (third-party / scratch). Hide others via overrides.
const DEFAULT_EXCLUDE = new Set(['OrbbecUnitySDK', 'touchdesigner-mcp', 'vitesse-nuxt'])
const JUNK = /^(?:my project|new folder)/i

function projectsRoot() {
  return process.env.PROJECTS_ROOT ? resolve(process.env.PROJECTS_ROOT) : resolve(process.cwd(), '..')
}

async function exec(cmd: string, args: string[], cwd?: string) {
  const { stdout } = await run(cmd, args, { cwd, timeout: 30_000, windowsHide: true })
  return stdout.trim()
}

async function ghAvailable() {
  try {
    await exec('gh', ['auth', 'status'])
    return true
  }
  catch {
    return false
  }
}

function repoSlug(remote: string) {
  const m = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote)
  return m?.[1] ?? null
}

async function detectCategory(dir: string, name: string): Promise<Category> {
  const has = (f: string) => existsSync(join(dir, f))
  if (has('ProjectSettings') && has('Assets'))
    return 'unity'
  if (['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'].some(has))
    return 'nuxt'
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      return deps.nuxt ? 'nuxt' : 'web'
    }
    catch {
      return 'web'
    }
  }
  const files = await readdir(dir).catch(() => [] as string[])
  if (files.some(f => f.endsWith('.py') || f === 'requirements.txt'))
    return 'python'
  if (files.some(f => f.endsWith('.csproj') || f.endsWith('.sln')))
    return 'dotnet'
  if (/unity/i.test(name))
    return 'unity'
  if (/nuxt/i.test(name))
    return 'nuxt'
  if (/python|_py$/i.test(name))
    return 'python'
  if (/_web/i.test(name))
    return 'web'
  return 'other'
}

async function readmeSummary(dir: string) {
  try {
    const text = await readFile(join(dir, 'README.md'), 'utf8')
    const line = text.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#') && !l.startsWith('[![') && !l.startsWith('<') && !l.startsWith('!['))
    return line ? line.slice(0, 180) : ''
  }
  catch {
    return ''
  }
}

async function inspectFolder(root: string, name: string, gh: boolean) {
  const dir = join(root, name)
  const isGit = existsSync(join(dir, '.git'))
  let remote: string | null = null
  let lastCommit: string | null = null
  if (isGit) {
    remote = await exec('git', ['-C', dir, 'remote', 'get-url', 'origin']).catch(() => null)
    lastCommit = await exec('git', ['-C', dir, 'log', '-1', '--format=%cI']).catch(() => null) || null
  }

  const slug = remote ? repoSlug(remote) : null
  let visibility: Visibility = slug ? 'unknown' : 'local'
  let ghDescription = ''
  if (slug && gh) {
    try {
      const out = await exec('gh', ['repo', 'view', slug, '--json', 'visibility,description'])
      const info = JSON.parse(out) as { visibility: string, description: string | null }
      visibility = info.visibility.toLowerCase() === 'public' ? 'public' : 'private'
      ghDescription = info.description ?? ''
    }
    catch (e) {
      if (String((e as { stderr?: string }).stderr ?? e).includes('Could not resolve to a Repository'))
        return { skipped: name }
    }
  }

  const project: Project = {
    id: name,
    title: name,
    category: await detectCategory(dir, name),
    visibility,
    description: ghDescription || await readmeSummary(dir),
    repoUrl: slug ? `https://github.com/${slug}` : null,
    demoUrl: null,
    lastCommit,
    path: dir,
    tags: [],
  }
  return { project }
}

async function candidateFolders(root: string) {
  const self = resolve(process.cwd())
  const entries = await readdir(root, { withFileTypes: true })
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .filter(n => resolve(root, n) !== self && !DEFAULT_EXCLUDE.has(n) && !JUNK.test(n))
    .sort()
}

export async function scanProjects(): Promise<ProjectsPayload> {
  const root = projectsRoot()
  const gh = await ghAvailable()
  const names = await candidateFolders(root)

  const projects: Project[] = []
  const skippedInaccessible: string[] = []
  const queue = [...names]
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let n = queue.shift(); n; n = queue.shift()) {
      const r = await inspectFolder(root, n, gh)
      if ('project' in r && r.project)
        projects.push(r.project)
      else if ('skipped' in r && r.skipped)
        skippedInaccessible.push(r.skipped)
    }
  }))

  projects.sort((a, b) => (b.lastCommit ?? '').localeCompare(a.lastCommit ?? '') || a.id.localeCompare(b.id))
  const payload: ProjectsPayload = { scannedAt: new Date().toISOString(), root, folders: names, skippedInaccessible: skippedInaccessible.sort(), projects }
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8')
  return payload
}

async function readOverrides(): Promise<Record<string, Override>> {
  try {
    return JSON.parse(await readFile(OVERRIDES_FILE, 'utf8'))
  }
  catch {
    return {}
  }
}

const OVERRIDE_CATEGORIES = new Set<Category>(['unity', 'nuxt', 'web', 'python', 'dotnet', 'other'])

/** Merge an edit into data/overrides.local.json. Empty values remove that field. */
export async function saveOverride(id: string, patch: Override) {
  const cached = JSON.parse(await readFile(CACHE_FILE, 'utf8').catch(() => '{"projects":[]}')) as ProjectsPayload
  if (!cached.projects.some(p => p.id === id))
    throw new Error(`Unknown project: ${id}`)
  if (patch.demoUrl && !/^https?:\/\//.test(patch.demoUrl))
    throw new Error('demoUrl must start with http:// or https://')
  if (patch.category && !OVERRIDE_CATEGORIES.has(patch.category))
    throw new Error('Invalid category')

  const all = await readOverrides()
  const next: Record<string, unknown> = { ...all[id] }
  const clean: Record<string, unknown> = {
    title: patch.title?.trim(),
    description: patch.description?.trim(),
    category: patch.category,
    demoUrl: patch.demoUrl?.trim(),
    tags: patch.tags?.map(t => t.trim()).filter(Boolean),
    hidden: patch.hidden,
  }
  for (const [key, value] of Object.entries(clean)) {
    if (!(key in patch))
      continue
    if (value === undefined || value === '' || value === false || (Array.isArray(value) && !value.length))
      delete next[key]
    else next[key] = value
  }
  if (Object.keys(next).length)
    all[id] = next as Override
  else delete all[id]

  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(OVERRIDES_FILE, JSON.stringify(all, null, 2), 'utf8')
}

export async function loadProjects(refresh = false): Promise<ProjectsPayload> {
  let payload: ProjectsPayload | null = null
  if (!refresh) {
    try {
      payload = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as ProjectsPayload
      // A folder was added/removed since the last scan -> rescan automatically
      const now = await candidateFolders(payload.root)
      if (!payload.folders || now.join('|') !== payload.folders.join('|'))
        payload = null
    }
    catch {
      payload = null
    }
  }
  payload ||= await scanProjects()

  const overrides = await readOverrides()
  const projects = payload.projects.map(p => ({ ...p, ...overrides[p.id], hidden: overrides[p.id]?.hidden === true }) as Project)
  return { ...payload, projects }
}
