import KpiModel from '../models/kpi.js'
import Venture from '../models/venture.js'
import ventureHealth from '../models/enums/ventureHealth.js'
import { calculateFounderStudents } from '../utils/founderPortfolio.js'

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

async function getMonthlyAverageKPIScores({
  year = new Date().getFullYear(),
} = {}) {
  const startOfYear = new Date(Date.UTC(year, 0, 1))
  const endOfYear = new Date(Date.UTC(year + 1, 0, 1))

  const [ventures, kpis] = await Promise.all([
    Venture.find().select('_id').populate('teamSize'),
    KpiModel.find({
      status: 'GRADED',
      score: { $gte: 0 },
      $or: [
        {
          evaluationDate: { $gte: startOfYear, $lt: endOfYear },
        },
      ],
    }),
  ])

  const ventureFoundersCount = new Map(
    ventures.map(v => [v._id.toString(), v.teamSize || 1])
  )

  const kpisByMonth = Array.from({ length: 12 }, () => [])
  for (const kpi of kpis) {
    const date = new Date(kpi.evaluationDate || kpi.createdAt)
    if (date >= startOfYear && date < endOfYear) {
      kpisByMonth[date.getUTCMonth()].push(kpi)
    }
  }

  const result = {}
  MONTH_NAMES.forEach((monthName, monthIndex) => {
    const monthKpis = kpisByMonth[monthIndex]
    if (monthKpis.length === 0) {
      result[monthName] = 0
      return
    }

    const byVenture = new Map()
    for (const kpi of monthKpis) {
      if (!kpi.venture) {
        continue
      }
      const vId = kpi.venture.toString()
      const current = byVenture.get(vId) || { sum: 0, count: 0 }
      current.sum += kpi.score
      current.count += 1
      byVenture.set(vId, current)
    }

    let totalScore = 0
    let totalWeight = 0
    for (const [vId, { sum, count }] of byVenture) {
      const weight = ventureFoundersCount.get(vId) || 0
      totalScore += (sum / count) * weight
      totalWeight += weight
    }

    result[monthName] = totalWeight ? Math.round(totalScore / totalWeight) : 0
  })

  return result
}

const getOverview = async (_, res) => {
  try {
    const [{ ventures, students }, kpi] = await Promise.all([
      calculateFounderStudents(),
      getMonthlyAverageKPIScores(),
    ])

    const overview = {
      founder: students.length,
      onTrack: students.filter(s => s.status === ventureHealth.ON_TRACK).length,
      watch: students.filter(s => s.status === ventureHealth.WATCH).length,
      atRisk: students.filter(s => s.status === ventureHealth.AT_RISK).length,
    }

    const result = ventures.reduce(
      (accumulate, currentValue) => {
        const campusKey = currentValue.campus?.name ?? 'Unknown'
        const stageKey = currentValue.stage ?? 'Unknown'

        accumulate.campus[campusKey] = (accumulate.campus[campusKey] ?? 0) + 1
        accumulate.stage[stageKey] = (accumulate.stage[stageKey] ?? 0) + 1

        return accumulate
      },
      { campus: {}, stage: {} }
    )
    return res.json({ result, kpi, overview })
  } catch (err) {
    console.error('Get overview error:', err)
    return res.status(500).json({
      error: 'Failed To load overdata',
    })
  }
}

export { getOverview }
