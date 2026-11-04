<script setup lang="ts">
import type { Category, Project, ProjectsPayload, Visibility } from '~~/server/utils/scanProjects'

definePageMeta({ layout: 'gallery' })

const { data } = await useFetch<ProjectsPayload>('/api/projects')

const rescanning = ref(false)
async function rescan() {
  rescanning.value = true
  try {
    data.value = await $fetch<ProjectsPayload>('/api/projects', { query: { refresh: 1 } })
  }
  finally {
    rescanning.value = false
  }
}

const categoryLabels: Record<Category, string> = {
  unity: 'Unity',
  nuxt: 'Nuxt',
  web: 'Web',
  python: 'Python',
  dotnet: '.NET',
  other: 'Other',
}
const categoryStyles: Record<Category, string> = {
  unity: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  nuxt: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  web: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  python: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  dotnet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  other: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
}
const visibilityLabels: Record<Visibility, string> = {
  public: 'Public',
  private: 'Private',
  local: 'Local only',
  unknown: 'Unknown',
}

const query = ref('')
const category = ref<Category | 'all'>('all')
const visibility = ref<Visibility | 'all'>('all')

const showHidden = ref(false)
const allProjects = computed(() => data.value?.projects ?? [])
const hiddenCount = computed(() => allProjects.value.filter(p => p.hidden).length)
const projects = computed(() => allProjects.value.filter(p => showHidden.value || !p.hidden))

// Edit dialog: saves to data/overrides.local.json (gitignored) via PATCH /api/projects/:id
const editing = ref<Project | null>(null)
const form = reactive({ title: '', description: '', category: 'other' as Category, demoUrl: '', tags: '', hidden: false })
const saveError = ref('')
function openEdit(p: Project) {
  editing.value = p
  saveError.value = ''
  Object.assign(form, {
    title: p.title === p.id ? '' : p.title,
    description: p.description,
    category: p.category,
    demoUrl: p.demoUrl ?? '',
    tags: p.tags.join(', '),
    hidden: !!p.hidden,
  })
}
async function saveEdit() {
  if (!editing.value)
    return
  try {
    await $fetch(`/api/projects/${encodeURIComponent(editing.value.id)}`, {
      method: 'PATCH',
      body: { ...form, tags: form.tags.split(',') },
    })
    editing.value = null
    data.value = await $fetch<ProjectsPayload>('/api/projects')
  }
  catch (e) {
    saveError.value = (e as { statusMessage?: string }).statusMessage ?? 'บันทึกไม่สำเร็จ'
  }
}

const categoryCounts = computed(() => {
  const counts = new Map<Category, number>()
  for (const p of projects.value)
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return projects.value.filter((p) => {
    if (category.value !== 'all' && p.category !== category.value)
      return false
    if (visibility.value !== 'all' && p.visibility !== visibility.value)
      return false
    if (!q)
      return true
    return [p.title, p.id, p.description, ...p.tags].join(' ').toLowerCase().includes(q)
  })
})

const copiedId = ref<string | null>(null)
const { copy } = useClipboard()
async function copyPath(p: Project) {
  await copy(p.path)
  copiedId.value = p.id
  setTimeout(() => {
    if (copiedId.value === p.id)
      copiedId.value = null
  }, 1500)
}

function vscodeUrl(p: Project) {
  return `vscode://file/${p.path.replace(/\\/g, '/')}`
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-'
}

const chip = 'rounded-full border px-3 py-1 text-sm transition cursor-pointer'
const chipOn = 'border-teal-600 bg-teal-600 text-white'
const chipOff = 'border-black/15 hover:border-teal-600 dark:border-white/20'
</script>

<template>
  <div>
    <header class="mb-8 flex flex-wrap gap-4 items-end justify-between">
      <div>
        <h1 class="text-3xl tracking-tight font-semibold">
          MOS Projects
        </h1>
        <p class="text-sm mt-1 opacity-60">
          {{ projects.length }} projects from <code>{{ data?.root }}</code>
        </p>
      </div>
      <div class="flex gap-2 items-center">
        <button class="btn" :disabled="rescanning" @click="rescan">
          {{ rescanning ? 'Scanning…' : 'Rescan' }}
        </button>
        <DarkToggle />
      </div>
    </header>

    <section class="mb-6 space-y-3">
      <input
        v-model="query"
        type="search"
        placeholder="ค้นหาชื่อ / คำอธิบาย…"
        class="px-4 py-2 outline-none border border-black/15 rounded-lg bg-transparent w-full dark:border-white/20 focus:border-teal-600"
      >
      <div class="flex flex-wrap gap-2">
        <button :class="[chip, category === 'all' ? chipOn : chipOff]" @click="category = 'all'">
          All {{ projects.length }}
        </button>
        <button
          v-for="[c, n] in categoryCounts"
          :key="c"
          :class="[chip, category === c ? chipOn : chipOff]"
          @click="category = c"
        >
          {{ categoryLabels[c] }} {{ n }}
        </button>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        <button
          v-for="v in (['all', 'private', 'public', 'local'] as const)"
          :key="v"
          :class="[chip, visibility === v ? chipOn : chipOff]"
          @click="visibility = v"
        >
          {{ v === 'all' ? 'ทุกสถานะ' : visibilityLabels[v] }}
        </button>
        <label v-if="hiddenCount" class="text-sm ml-auto opacity-70 flex gap-2 cursor-pointer items-center">
          <input v-model="showHidden" type="checkbox">
          แสดงที่ซ่อนไว้ ({{ hiddenCount }})
        </label>
      </div>
    </section>

    <p v-if="!filtered.length" class="py-16 text-center opacity-50">
      ไม่พบโปรเจคที่ตรงกับตัวกรอง
    </p>

    <ul class="gap-4 grid lg:grid-cols-3 sm:grid-cols-2">
      <li
        v-for="p in filtered"
        :key="p.id"
        class="p-4 border border-black/10 rounded-xl flex flex-col transition dark:border-white/15 hover:border-teal-600"
        :class="{ 'opacity-50': p.hidden }"
      >
        <div class="mb-2 flex gap-2 items-center justify-between">
          <span class="text-xs font-medium px-2 py-0.5 rounded" :class="categoryStyles[p.category]">
            {{ categoryLabels[p.category] }}
          </span>
          <span class="text-xs opacity-60 flex gap-1 items-center">
            <span :class="p.visibility === 'public' ? 'i-carbon-unlocked' : 'i-carbon-locked'" />
            {{ visibilityLabels[p.visibility] }}
          </span>
        </div>

        <h2 class="text-sm font-mono font-semibold break-all">
          {{ p.title }}
        </h2>
        <p class="text-sm mt-1 opacity-70 min-h-[3.5em] line-clamp-3">
          {{ p.description || 'ยังไม่มีคำอธิบาย' }}
        </p>
        <ul v-if="p.tags.length" class="mt-2 flex flex-wrap gap-1">
          <li v-for="t in p.tags" :key="t" class="text-xs px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10">
            {{ t }}
          </li>
        </ul>
        <p class="text-xs mt-2 opacity-50">
          อัปเดตล่าสุด {{ formatDate(p.lastCommit) }}
        </p>

        <div class="text-sm mt-4 flex flex-wrap gap-2">
          <a :href="vscodeUrl(p)" class="btn !px-3 !py-0.5" title="เปิดใน VS Code">
            VS Code
          </a>
          <a v-if="p.repoUrl" :href="p.repoUrl" target="_blank" rel="noopener" class="icon-btn px-2 py-0.5">
            GitHub
          </a>
          <a v-if="p.demoUrl" :href="p.demoUrl" target="_blank" rel="noopener" class="icon-btn px-2 py-0.5">
            Demo
          </a>
          <button class="icon-btn px-2 py-0.5" @click="copyPath(p)">
            {{ copiedId === p.id ? 'Copied!' : 'Copy path' }}
          </button>
          <button class="icon-btn ml-auto px-2 py-0.5" @click="openEdit(p)">
            Edit
          </button>
        </div>
      </li>
    </ul>

    <div
      v-if="editing"
      class="p-4 bg-black/50 flex items-center inset-0 justify-center fixed z-50"
      @click.self="editing = null"
    >
      <form class="p-6 rounded-xl bg-white max-w-lg w-full shadow-xl space-y-3 dark:bg-neutral-900" @submit.prevent="saveEdit">
        <h2 class="text-sm font-mono font-semibold">
          {{ editing.id }}
        </h2>
        <label class="text-sm block">ชื่อที่แสดง
          <input v-model="form.title" :placeholder="editing.id" class="mt-1 px-3 py-1.5 border border-black/15 rounded bg-transparent w-full dark:border-white/20">
        </label>
        <label class="text-sm block">คำอธิบาย
          <textarea v-model="form.description" rows="3" class="mt-1 px-3 py-1.5 border border-black/15 rounded bg-transparent w-full dark:border-white/20" />
        </label>
        <div class="gap-3 grid grid-cols-2">
          <label class="text-sm block">หมวด
            <select v-model="form.category" class="mt-1 px-2 py-1.5 border border-black/15 rounded bg-transparent w-full dark:border-white/20 dark:bg-neutral-900">
              <option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <label class="text-sm block">แท็ก (คั่นด้วย ,)
            <input v-model="form.tags" class="mt-1 px-3 py-1.5 border border-black/15 rounded bg-transparent w-full dark:border-white/20">
          </label>
        </div>
        <label class="text-sm block">ลิงก์ Demo
          <input v-model="form.demoUrl" type="url" placeholder="https://…" class="mt-1 px-3 py-1.5 border border-black/15 rounded bg-transparent w-full dark:border-white/20">
        </label>
        <label class="text-sm flex gap-2 items-center">
          <input v-model="form.hidden" type="checkbox"> ซ่อนโปรเจคนี้
        </label>
        <p v-if="saveError" class="text-sm text-red-600">
          {{ saveError }}
        </p>
        <div class="pt-2 flex gap-2 justify-end">
          <button type="button" class="icon-btn px-3 py-1" @click="editing = null">
            ยกเลิก
          </button>
          <button type="submit" class="btn">
            บันทึก
          </button>
        </div>
      </form>
    </div>

    <footer v-if="data?.skippedInaccessible.length" class="text-xs mt-10 opacity-40">
      ข้าม {{ data.skippedInaccessible.length }} โปรเจคที่เข้าถึง repo ไม่ได้: {{ data.skippedInaccessible.join(', ') }}
    </footer>
  </div>
</template>
