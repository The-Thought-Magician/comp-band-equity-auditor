import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  workspaces,
  datasets,
  employees,
  band_sets,
  bands,
} from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// requireWorkspace — auto-provision one workspace per user on first authed call
// ---------------------------------------------------------------------------

async function requireWorkspace(userId: string) {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.owner_id, userId))
  if (existing) return existing
  const [created] = await db
    .insert(workspaces)
    .values({ name: 'My Workspace', owner_id: userId, base_currency: 'USD' })
    .returning()
  return created
}

// ---------------------------------------------------------------------------
// Synthetic org generator: ~80 employees with planted outliers + gender gap.
// Deterministic (no RNG) so the seeded shape is stable and auditable.
// ---------------------------------------------------------------------------

interface BandSpec {
  level: string
  role_family: string
  geo: string
  min_salary: number
  mid_salary: number
  max_salary: number
}

// Band grid: 3 role families x 4 levels in a single geo (US).
const BAND_GRID: BandSpec[] = [
  // Engineering
  { level: 'L1', role_family: 'Engineering', geo: 'US', min_salary: 90000, mid_salary: 110000, max_salary: 130000 },
  { level: 'L2', role_family: 'Engineering', geo: 'US', min_salary: 120000, mid_salary: 150000, max_salary: 180000 },
  { level: 'L3', role_family: 'Engineering', geo: 'US', min_salary: 160000, mid_salary: 195000, max_salary: 230000 },
  { level: 'L4', role_family: 'Engineering', geo: 'US', min_salary: 210000, mid_salary: 255000, max_salary: 300000 },
  // Sales
  { level: 'L1', role_family: 'Sales', geo: 'US', min_salary: 70000, mid_salary: 85000, max_salary: 100000 },
  { level: 'L2', role_family: 'Sales', geo: 'US', min_salary: 95000, mid_salary: 115000, max_salary: 135000 },
  { level: 'L3', role_family: 'Sales', geo: 'US', min_salary: 125000, mid_salary: 150000, max_salary: 175000 },
  { level: 'L4', role_family: 'Sales', geo: 'US', min_salary: 165000, mid_salary: 200000, max_salary: 235000 },
  // Marketing
  { level: 'L1', role_family: 'Marketing', geo: 'US', min_salary: 65000, mid_salary: 80000, max_salary: 95000 },
  { level: 'L2', role_family: 'Marketing', geo: 'US', min_salary: 90000, mid_salary: 108000, max_salary: 126000 },
  { level: 'L3', role_family: 'Marketing', geo: 'US', min_salary: 118000, mid_salary: 140000, max_salary: 162000 },
  { level: 'L4', role_family: 'Marketing', geo: 'US', min_salary: 155000, mid_salary: 185000, max_salary: 215000 },
]

const FIRST_NAMES_F = ['Alice', 'Beth', 'Carol', 'Dana', 'Elena', 'Fiona', 'Grace', 'Hana', 'Iris', 'Julia', 'Kira', 'Lena', 'Mona', 'Nora', 'Olive', 'Petra']
const FIRST_NAMES_M = ['Aaron', 'Ben', 'Carl', 'Dan', 'Evan', 'Frank', 'Gary', 'Hugo', 'Ian', 'Jack', 'Kyle', 'Liam', 'Marc', 'Neil', 'Owen', 'Paul']
const LAST_NAMES = ['Smith', 'Jones', 'Patel', 'Kim', 'Garcia', 'Brown', 'Khan', 'Lee', 'Nguyen', 'Walsh', 'Rossi', 'Cohen', 'Diaz', 'Park', 'Singh', 'Wood']

interface EmployeeSpec {
  employee_ref: string
  name: string
  level: string
  role_family: string
  geo: string
  gender: string
  ethnicity: string
  tenure_months: number
  hire_date: string
  performance_rating: number
  base_salary: number
  currency: string
  fte: number
  tags: string[]
}

/**
 * Build ~80 employees. Salaries are anchored on the band midpoint, then a
 * deterministic per-index wobble is applied. A systematic gender gap is planted
 * (women paid ~8% below band mid relative to men at the same level/family) plus
 * a handful of explicit outliers (one far above max, one far below min).
 */
function generateEmployees(): EmployeeSpec[] {
  const out: EmployeeSpec[] = []
  const ethnicities = ['White', 'Asian', 'Hispanic', 'Black', 'Other']

  // Distribute headcount across the grid so the total lands near 80.
  // More juniors than seniors.
  const perCell: Record<string, number> = {
    L1: 4,
    L2: 3,
    L3: 2,
    L4: 1,
  }

  let i = 0
  for (const cell of BAND_GRID) {
    const headcount = perCell[cell.level] ?? 2
    for (let k = 0; k < headcount; k++) {
      // Alternate gender deterministically so each cell has a mix.
      const isFemale = (i + k) % 2 === 0
      const gender = isFemale ? 'female' : 'male'
      const names = isFemale ? FIRST_NAMES_F : FIRST_NAMES_M
      const first = names[(i + k) % names.length]
      const last = LAST_NAMES[(i * 3 + k) % LAST_NAMES.length]

      // Base around band mid with a small deterministic wobble.
      const wobble = ((i * 7 + k * 13) % 21) - 10 // -10..+10 (%)
      let salary = cell.mid_salary * (1 + wobble / 200) // +/-5%

      // Plant the systematic gender gap: women ~8% below their counterparts.
      if (isFemale) salary *= 0.92

      // Tenure / performance vary deterministically.
      const tenure = 6 + ((i * 5 + k * 11) % 90)
      const perf = 2.5 + (((i + k) % 5) * 0.5) // 2.5..4.5
      const hireYear = 2026 - Math.floor(tenure / 12)
      const hireMonth = ((i + k) % 12) + 1

      out.push({
        employee_ref: `EMP-${String(out.length + 1).padStart(4, '0')}`,
        name: `${first} ${last}`,
        level: cell.level,
        role_family: cell.role_family,
        geo: cell.geo,
        gender,
        ethnicity: ethnicities[(i * 2 + k) % ethnicities.length],
        tenure_months: tenure,
        hire_date: `${hireYear}-${String(hireMonth).padStart(2, '0')}-01`,
        performance_rating: Math.round(perf * 10) / 10,
        base_salary: Math.round(salary),
        currency: 'USD',
        fte: 1,
        tags: [],
      })
    }
    i++
  }

  // -------------------------------------------------------------------
  // Planted explicit outliers (appended on top of the grid population).
  // -------------------------------------------------------------------

  // 1. Severe overpay: paid far above the max for their band.
  out.push({
    employee_ref: `EMP-${String(out.length + 1).padStart(4, '0')}`,
    name: 'Quincy Vaughn',
    level: 'L2',
    role_family: 'Engineering',
    geo: 'US',
    gender: 'male',
    ethnicity: 'White',
    tenure_months: 14,
    hire_date: '2025-04-01',
    performance_rating: 3.0,
    base_salary: 235000, // band L2 Eng max is 180k
    currency: 'USD',
    fte: 1,
    tags: ['outlier'],
  })

  // 2. Severe underpay: a high performer paid well below band min.
  out.push({
    employee_ref: `EMP-${String(out.length + 1).padStart(4, '0')}`,
    name: 'Rhea Donovan',
    level: 'L3',
    role_family: 'Engineering',
    geo: 'US',
    gender: 'female',
    ethnicity: 'Asian',
    tenure_months: 52,
    hire_date: '2022-02-01',
    performance_rating: 4.5,
    base_salary: 132000, // band L3 Eng min is 160k
    currency: 'USD',
    fte: 1,
    tags: ['outlier'],
  })

  // 3. Underpaid senior woman amplifying the gap signal.
  out.push({
    employee_ref: `EMP-${String(out.length + 1).padStart(4, '0')}`,
    name: 'Sasha Reyes',
    level: 'L4',
    role_family: 'Sales',
    geo: 'US',
    gender: 'female',
    ethnicity: 'Hispanic',
    tenure_months: 60,
    hire_date: '2021-06-01',
    performance_rating: 4.0,
    base_salary: 168000, // band L4 Sales min is 165k, just above floor vs male peers near mid 200k
    currency: 'USD',
    fte: 1,
    tags: ['outlier'],
  })

  return out
}

// ---------------------------------------------------------------------------
// POST /seed — auth — seed synthetic org into caller's workspace if empty.
// ---------------------------------------------------------------------------

router.post('/seed', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)

  // Idempotency: if the workspace already has any dataset, do not re-seed.
  const [existingDataset] = await db
    .select()
    .from(datasets)
    .where(eq(datasets.workspace_id, ws.id))
    .limit(1)
  if (existingDataset) {
    const [existingBandSet] = await db
      .select()
      .from(band_sets)
      .where(eq(band_sets.workspace_id, ws.id))
      .limit(1)
    return c.json({
      seeded: false,
      dataset_id: existingDataset.id,
      band_set_id: existingBandSet?.id ?? null,
    })
  }

  const empSpecs = generateEmployees()

  // 1. Dataset version.
  const [dataset] = await db
    .insert(datasets)
    .values({
      workspace_id: ws.id,
      version: 1,
      label: 'Sample Org (synthetic)',
      source: 'sample',
      row_count: empSpecs.length,
      rejected_rows: [],
      status: 'ready',
      created_by: userId,
    })
    .returning()

  // 2. Employee rows.
  for (const e of empSpecs) {
    await db.insert(employees).values({
      dataset_id: dataset.id,
      workspace_id: ws.id,
      employee_ref: e.employee_ref,
      name: e.name,
      level: e.level,
      role_family: e.role_family,
      geo: e.geo,
      gender: e.gender,
      ethnicity: e.ethnicity,
      tenure_months: e.tenure_months,
      hire_date: e.hire_date,
      performance_rating: e.performance_rating,
      base_salary: e.base_salary,
      currency: e.currency,
      fte: e.fte,
      tags: e.tags,
    })
  }

  // 3. Band set version.
  const [bandSet] = await db
    .insert(band_sets)
    .values({
      workspace_id: ws.id,
      version: 1,
      label: 'Sample Bands FY26',
      effective_from: '2026-01-01',
      status: 'published',
      notes: 'Synthetic comp bands seeded alongside the sample org.',
      created_by: userId,
    })
    .returning()

  // 4. Band rows.
  for (const b of BAND_GRID) {
    await db.insert(bands).values({
      band_set_id: bandSet.id,
      workspace_id: ws.id,
      level: b.level,
      role_family: b.role_family,
      geo: b.geo,
      currency: 'USD',
      min_salary: b.min_salary,
      mid_salary: b.mid_salary,
      max_salary: b.max_salary,
      target_compa_low: 0.9,
      target_compa_high: 1.1,
      notes: null,
    })
  }

  return c.json(
    {
      seeded: true,
      dataset_id: dataset.id,
      band_set_id: bandSet.id,
      employees: empSpecs.length,
      bands: BAND_GRID.length,
    },
    201,
  )
})

// ---------------------------------------------------------------------------
// GET /status — public(header user) — whether any data exists for workspace.
// ---------------------------------------------------------------------------

router.get('/status', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  if (!userId) return c.json({ hasData: false })

  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.owner_id, userId))
  if (!ws) return c.json({ hasData: false })

  const [dataset] = await db
    .select()
    .from(datasets)
    .where(eq(datasets.workspace_id, ws.id))
    .limit(1)

  return c.json({ hasData: !!dataset })
})

export default router
