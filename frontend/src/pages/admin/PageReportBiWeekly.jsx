import * as React from 'react'
import { useLoaderData, useRevalidator } from 'react-router'

import {
  reopenBiWeeklySubmission,
  saveBiWeeklyEvaluation,
  saveBiWeeklyObservation,
  submitBiWeeklyCycle,
} from '../../api/biweekly'
import toError from '../../api/toError'

import { useAuthStore } from '../../stores/auth'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Link from '@mui/material/Link'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import AddIcon from '@mui/icons-material/Add'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DeleteIcon from '@mui/icons-material/Delete'
import LockIcon from '@mui/icons-material/Lock'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

const CYCLES = 13 // 26 weeks = 13 bi-weekly cycles
const GRACE_DAYS = 3

/* ---------- Evidence checklist per cycle (stage-aware) ---------- */
const CHECKLISTS = [
  {
    stage: 'Discovery — Kickoff',
    items: [
      {
        key: 'problem_doc',
        label: 'Problem statement (1-pager)',
        hint: 'Who hurts, how much, why now.',
      },
      {
        key: 'interviews_3',
        label: '3 customer discovery interviews (recording or transcript)',
      },
      { key: 'assumptions_map', label: 'Riskiest assumptions map' },
      { key: 'goals_2w', label: '2-week goals doc' },
    ],
  },
  {
    stage: 'Discovery — Expand',
    items: [
      { key: 'interviews_5', label: '5 more customer interviews' },
      { key: 'jtbd', label: 'Jobs-to-be-Done statements (3 personas)' },
      { key: 'competitor_map', label: 'Competitor / alternatives map' },
      { key: 'insight_note', label: 'Discovery insight note (what changed)' },
    ],
  },
  {
    stage: 'Validation — Signal',
    items: [
      { key: 'landing_page', label: 'Landing page live URL' },
      { key: 'waitlist_signups', label: 'Waitlist signups screenshot (≥25)' },
      { key: 'survey_results', label: 'Survey results (n ≥ 20)' },
      { key: 'pricing_hyp', label: 'Pricing hypothesis doc' },
    ],
  },
  {
    stage: 'Validation — Commit',
    items: [
      { key: 'loi_or_prepay', label: 'Letter of intent or pre-payment (≥1)' },
      { key: 'wizard_test', label: 'Wizard-of-Oz / concierge test log' },
      { key: 'value_prop_v2', label: 'Value prop v2 (revised)' },
      { key: 'assumption_kill', label: 'Assumptions killed / kept summary' },
    ],
  },
  {
    stage: 'MVP — Build v1',
    items: [
      { key: 'mvp_demo', label: 'MVP demo video (≤3 min)' },
      { key: 'tech_doc', label: 'Architecture / build doc' },
      { key: 'user_test_3', label: '3 user testing recordings' },
      { key: 'bug_log', label: 'Bug / iteration log' },
    ],
  },
  {
    stage: 'MVP — Iterate',
    items: [
      { key: 'mvp_v2_demo', label: 'MVP v2 demo (post-iteration)' },
      { key: 'usability_report', label: 'Usability findings report' },
      {
        key: 'activation_metric',
        label: 'Activation metric definition + first read',
      },
      { key: 'roadmap_next', label: 'Roadmap for next cycle' },
    ],
  },
  {
    stage: 'Pilot — Launch',
    items: [
      { key: 'pilot_users', label: 'Pilot user list (≥5 with contact)' },
      { key: 'onboarding_flow', label: 'Onboarding flow doc' },
      { key: 'feedback_log', label: 'Structured pilot feedback log' },
      { key: 'nps_or_csat', label: 'NPS / CSAT first read' },
    ],
  },
  {
    stage: 'Pilot — Retain',
    items: [
      { key: 'retention_chart', label: 'W1/W2 retention chart' },
      { key: 'case_study', label: '1 written case study' },
      { key: 'pricing_test', label: 'Pricing test results' },
      { key: 'churn_reasons', label: 'Churn interviews (≥3)' },
    ],
  },
  {
    stage: 'Traction — Revenue',
    items: [
      { key: 'revenue_proof', label: 'Revenue proof (invoices / stripe)' },
      { key: 'cac_ltv', label: 'CAC / LTV first estimate' },
      { key: 'growth_chart', label: 'Weekly growth chart (last 8 weeks)' },
      { key: 'channel_test', label: 'Channel test summary' },
    ],
  },
  {
    stage: 'Traction — Scale readiness',
    items: [
      { key: 'unit_econ', label: 'Unit economics model' },
      { key: 'hiring_plan', label: 'Hiring / capacity plan' },
      { key: 'ops_playbook', label: 'Ops playbook v1' },
      { key: 'risk_register', label: 'Risk register' },
    ],
  },
  {
    stage: 'Final — Story',
    items: [
      { key: 'pitch_deck', label: 'Investor / defense deck v1' },
      { key: 'financial_model', label: '12-month financial model' },
      { key: 'team_bios', label: 'Team & advisors doc' },
      { key: 'traction_1pager', label: 'Traction 1-pager' },
    ],
  },
  {
    stage: 'Final — Rehearsal',
    items: [
      { key: 'pitch_v2', label: 'Deck v2 (post-mentor review)' },
      { key: 'dry_run_video', label: 'Dry-run pitch video' },
      { key: 'qa_prep', label: 'Q&A prep doc (20 questions)' },
      { key: 'next_6mo_plan', label: 'Next 6-month plan' },
    ],
  },
  {
    stage: 'Final — Defense',
    items: [
      { key: 'final_deck', label: 'Final defense deck (locked)' },
      { key: 'demo_final', label: 'Final demo recording' },
      {
        key: 'outcomes_doc',
        label: 'Outcomes summary (what shipped, what next)',
      },
      { key: 'career_reco_form', label: 'Career recommendation intake filled' },
    ],
  },
]

const STATUS_COLOR = { green: 'success', yellow: 'warning', red: 'error' }

function computeCycles(startISO) {
  const start = new Date(startISO)
  return Array.from({ length: CYCLES }, (_, i) => {
    const s = new Date(start)
    s.setDate(start.getDate() + i * 14)
    const e = new Date(s)
    e.setDate(s.getDate() + 13)
    const deadline = new Date(e)
    deadline.setDate(deadline.getDate() + GRACE_DAYS)
    return { n: i + 1, start: s, end: e, deadline }
  })
}

function shortDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function BiWeekly({ data: propData }) {
  const loaderData = useLoaderData()
  const data = propData !== undefined ? propData : loaderData
  const currentUser = useAuthStore(state => state.user)
  const revalidator = useRevalidator()
  const isAdmin = currentUser?.role?.name === 'admin'

  const { founder, venture, coFounders = [] } = data || {}
  const rows = data?.submissions ?? []
  const observations = data?.observations ?? []
  const evaluations = data?.evaluations ?? []
  const [selected, setSelected] = React.useState(null)
  const [message, setMessage] = React.useState('')

  const cycles = React.useMemo(
    () => computeCycles(venture?.createdAt || founder?.createdAt || new Date()),
    [venture?.createdAt, founder?.createdAt]
  )

  const currentCycle = React.useMemo(() => {
    const now = new Date()
    const c = cycles.find(c => now >= c.start && now <= c.end)
    return c?.n ?? cycles.find(c => now < c.start)?.n ?? CYCLES
  }, [cycles])

  if (!data || (!founder && !venture)) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          No active venture or founder profile found. Bi-weekly progress reports are shared across co-founders of an active venture.
        </Alert>
      </Box>
    )
  }

  const active = selected ?? currentCycle
  const activeMeta = cycles.find(c => c.n === active)
  const activeRow = rows.find(r => r.cycle_number === active)
  const submittedCount = rows.filter(r => r.submitted_at).length
  const missedCount = cycles.filter(
    c =>
      c.deadline < new Date() &&
      !rows.find(r => r.cycle_number === c.n && r.submitted_at)
  ).length

  // Each of these calls the API directly and then asks the route loader to
  // refetch, in place of the route action that used to dispatch on an intent.
  const run = async (pending, operation) => {
    setMessage(pending)

    try {
      await operation()
      setMessage('')
      revalidator.revalidate()
    } catch (err) {
      setMessage(toError(err, 'Action failed').error)
    }
  }

  const saveSubmission = (payload, submit) =>
    run(submit ? 'Submitting to faculty...' : 'Saving draft...', () =>
      submitBiWeeklyCycle({
        ...payload,
        isSubmit: submit,
        ventureId: venture?._id,
        founderId: founder?._id,
      })
    )

  const reopenSubmission = cycleNumber => {
    if (!window.confirm('Unlock to edit? Faculty will see this as re-opened.'))
      return

    return run('Unlocking...', () =>
      reopenBiWeeklySubmission({
        ventureId: venture?._id,
        founderId: founder?._id,
        cycle_number: cycleNumber,
      })
    )
  }

  const saveObservation = payload =>
    run('Saving observation...', () =>
      saveBiWeeklyObservation({
        ...payload,
        ventureId: venture?._id,
        founderId: founder?._id,
      })
    )

  const saveEvaluation = payload =>
    run('Saving evaluation...', () =>
      saveBiWeeklyEvaluation({
        ...payload,
        ventureId: venture?._id,
        founderId: founder?._id,
      })
    )

  return (
    <Stack spacing={3}>
      <Box>
        <Typography
          variant="overline"
          sx={{ color: 'text.secondary', display: 'block' }}
        >
          Bi-weekly portal
        </Typography>
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
        >
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {venture?.name || founder?.username || 'Venture Progress'}
            </Typography>
            {venture?.stage && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Stage: <strong>{venture.stage}</strong>
              </Typography>
            )}
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Current cycle #{currentCycle}
          </Typography>
        </Stack>

        {coFounders?.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}
            >
              Co-Founders (Shared Venture Team):
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {coFounders.map(cf => (
                <Chip
                  key={cf._id}
                  label={cf.username}
                  size="small"
                  variant="outlined"
                  color="primary"
                />
              ))}
            </Stack>
          </Box>
        )}

        {!venture && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            You are not currently linked to an active venture. Bi-weekly reports are shared across co-founders of your venture team.
          </Alert>
        )}
      </Box>

      <MyProgress
        submittedCount={submittedCount}
        missedCount={missedCount}
        totalCycles={CYCLES}
        currentCycle={currentCycle}
        evaluations={evaluations}
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(4, 1fr)',
            md: 'repeat(7, 1fr)',
            lg: 'repeat(13, 1fr)',
          },
          gap: 1,
        }}
      >
        {cycles.map(c => {
          const row = rows.find(r => r.cycle_number === c.n)
          const submitted = !!row?.submitted_at
          const draft = !!row && !submitted
          const now = new Date()
          const upcoming = now < c.start
          const missed = c.deadline < now && !submitted
          const isActive = c.n === active
          const color = submitted
            ? 'success'
            : missed
              ? 'error'
              : draft
                ? 'warning'
                : 'inherit'
          return (
            <Button
              key={c.n}
              onClick={() => setSelected(c.n)}
              variant={isActive ? 'contained' : 'outlined'}
              color={color}
              size="small"
              sx={{
                flexDirection: 'column',
                alignItems: 'flex-start',
                textTransform: 'none',
                p: 1,
                opacity: upcoming && !isActive ? 0.6 : 1,
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                Cycle {c.n}
                {c.n === currentCycle ? ' •' : ''}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                {shortDate(c.start)} – {shortDate(c.end)}
              </Typography>
              <Typography variant="caption">
                {submitted
                  ? 'Submitted'
                  : missed
                    ? 'Missed'
                    : draft
                      ? 'Draft'
                      : upcoming
                        ? 'Upcoming'
                        : 'Open'}
              </Typography>
            </Button>
          )
        })}
      </Box>

      <CycleForm
        key={activeMeta.n}
        cycleNumber={activeMeta.n}
        periodStart={activeMeta.start.toISOString().slice(0, 10)}
        periodEnd={activeMeta.end.toISOString().slice(0, 10)}
        deadline={activeMeta.deadline}
        existing={activeRow}
        isAdmin={isAdmin}
        onSave={saveSubmission}
        onReopen={reopenSubmission}
      />

      <MentorObservationSection
        key={`obs-${activeMeta.n}-${observations.find(o => o.cycle_number === activeMeta.n)?._id ?? 'none'}`}
        cycleNumber={activeMeta.n}
        submission={activeRow}
        observation={observations.find(o => o.cycle_number === activeMeta.n)}
        canAuthor={isAdmin}
        onSave={saveObservation}
      />

      <EvaluationSection
        key={`eval-${activeMeta.n}-${evaluations.find(e => e.checklist_id === activeMeta.n || e.month_number === Math.ceil(activeMeta.n / 2))?._id ?? 'none'}`}
        cycleNumber={activeMeta.n}
        evaluation={evaluations.find(
          e =>
            e.checklist_id === activeMeta.n ||
            e.month_number === Math.ceil(activeMeta.n / 2)
        )}
        canAuthor={isAdmin}
        onSave={saveEvaluation}
      />

      <Snackbar
        open={!!message}
        autoHideDuration={2500}
        onClose={() => setMessage('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setMessage('')}>
          {message}
        </Alert>
      </Snackbar>
    </Stack>
  )
}

/* =========== My Progress panel =========== */
function MyProgress({
  submittedCount,
  missedCount,
  totalCycles,
  currentCycle,
  evaluations,
}) {
  const pct = Math.round((submittedCount / totalCycles) * 100)
  const latest = evaluations[0]

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>
          My progress
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            gap: 2,
            mt: 1,
          }}
        >
          <Stat
            label="Cycles submitted"
            value={
              <Typography variant="h5" component="span">
                {submittedCount}
                <Typography component="span" sx={{ color: 'text.secondary' }}>
                  /{totalCycles}
                </Typography>
              </Typography>
            }
            sub={
              <Stack direction="row" spacing={1} alignItems="center">
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  color="success"
                  sx={{ flexGrow: 1 }}
                />
                <span>{pct}%</span>
              </Stack>
            }
          />
          <Stat
            label="Current status"
            value={
              latest?.status ? (
                <Chip
                  size="small"
                  variant="outlined"
                  color={STATUS_COLOR[latest.status]}
                  label={latest.status}
                  sx={{ textTransform: 'capitalize' }}
                />
              ) : (
                'No review yet'
              )
            }
            sub={
              missedCount > 0 ? (
                <Stack
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                  sx={{ color: 'error.main' }}
                >
                  <WarningAmberIcon fontSize="inherit" />
                  <span>
                    {missedCount} missed cycle{missedCount > 1 ? 's' : ''}
                  </span>
                </Stack>
              ) : (
                `On track · cycle #${currentCycle}`
              )
            }
          />
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Recent scores
            </Typography>
            {evaluations.length === 0 && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                No evaluations yet.
              </Typography>
            )}
            {evaluations.slice(0, 4).map(e => (
              <Stack
                key={e.id}
                direction="row"
                justifyContent="space-between"
                sx={{ fontSize: 13 }}
              >
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  M{e.month_number} · {shortDate(new Date(e.created_at))}
                </Box>
                <Box component="span" sx={{ fontFamily: 'monospace' }}>
                  {e.total_score}/100
                </Box>
              </Stack>
            ))}
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, sub }) {
  return (
    <Box>
      <Typography
        variant="overline"
        sx={{ color: 'text.secondary', display: 'block' }}
      >
        {label}
      </Typography>
      <Box sx={{ fontSize: 14 }}>{value}</Box>
      {sub && (
        <Box sx={{ fontSize: 12, mt: 0.5, color: 'text.secondary' }}>{sub}</Box>
      )}
    </Box>
  )
}

/* =========== Cycle Form (checklist + lock) =========== */
const BASELINE = {
  progress_summary: '',
  wins: '',
  blockers: '',
  hours_worked: 0,
  customer_interviews: 0,
  features_shipped: 0,
  revenue: 0,
  users_acquired: 0,
  experiments_run: 0,
  mentor_meeting_date: '',
  mentor_meeting_notes: '',
  goals_next_cycle: '',
  ask_for_help: '',
}

function CycleForm({
  cycleNumber,
  periodStart,
  periodEnd,
  deadline,
  existing,
  isAdmin,
  onSave,
  onReopen,
}) {
  const [f, setF] = React.useState(() =>
    existing
      ? Object.fromEntries(
          Object.keys(BASELINE).map(k => [k, existing[k] ?? BASELINE[k]])
        )
      : BASELINE
  )
  const [links, setLinks] = React.useState(() =>
    Array.isArray(existing?.evidence_links) ? existing.evidence_links : []
  )
  const [checked, setChecked] = React.useState(() => {
    const map = {}
    const evLinks = Array.isArray(existing?.evidence_links)
      ? existing.evidence_links
      : []
    evLinks.forEach(l => {
      if (l.check) map[l.check] = true
    })
    return map
  })

  const now = new Date()
  const submitted = !!existing?.submitted_at
  const pastDeadline = deadline < now
  // Admin view is read-only (admin cannot submit student progress). Student is locked if submitted or past deadline.
  const locked = isAdmin ? true : submitted || pastDeadline
  const checklist = CHECKLISTS[cycleNumber + 1]

  const requiredCount = checklist?.items.length ?? 0
  const doneCount =
    checklist?.items.filter(
      i => checked[i.key] || links.some(l => l.check === i.key && l.url)
    ).length ?? 0
  const daysToDeadline = Math.ceil(
    (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  )

  const save = submit => {
    const linksWithChecks = links.map(l => ({
      title: l.title,
      url: l.url,
      ...(l.check ? { check: l.check } : {}),
    }))
    const trackedCheckKeys = new Set(
      linksWithChecks.filter(l => l.check).map(l => l.check)
    )
    const extra = Object.entries(checked)
      .filter(([k, v]) => v && !trackedCheckKeys.has(k))
      .map(([k]) => ({
        title: checklist?.items.find(i => i.key === k)?.label ?? k,
        url: '',
        check: k,
        self_confirmed: true,
      }))

    onSave(
      {
        ...f,
        cycle_number: cycleNumber,
        period_start: periodStart,
        period_end: periodEnd,
        evidence_links: [...linksWithChecks, ...extra],
        mentor_meeting_date: f.mentor_meeting_date || null,
      },
      submit
    )
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          flexWrap="wrap"
          gap={1}
        >
          <Box>
            <Typography variant="h6">
              Cycle {cycleNumber}
              {checklist && (
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ color: 'text.secondary' }}
                >
                  {' '}
                  · {checklist.stage}
                </Typography>
              )}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {new Date(periodStart).toLocaleDateString()} –{' '}
              {new Date(periodEnd).toLocaleDateString()} · Deadline:{' '}
              {deadline.toLocaleDateString()}
              {!pastDeadline &&
                !submitted &&
                ` (${daysToDeadline} day${daysToDeadline === 1 ? '' : 's'} left)`}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {isAdmin && (
              <Chip
                size="small"
                color="info"
                variant="outlined"
                label="Admin view (read-only)"
              />
            )}
            {submitted && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                icon={<CheckCircleIcon />}
                label="Submitted"
              />
            )}
            {!submitted && pastDeadline && (
              <Chip
                size="small"
                color="error"
                variant="outlined"
                icon={<LockIcon />}
                label="Missed & locked"
              />
            )}
            {isAdmin && (submitted || pastDeadline) && existing && (
              <Button size="small" onClick={() => onReopen(cycleNumber)}>
                Reopen for student
              </Button>
            )}
          </Stack>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Stack spacing={2}>
          {checklist && (
            <Box
              sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                  Required this cycle
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {doneCount}/{requiredCount}
                </Typography>
              </Stack>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                  gap: 1,
                }}
              >
                {checklist.items.map(item => {
                  const hasLink = links.some(l => l.check === item.key && l.url)
                  const done = hasLink || !!checked[item.key]
                  return (
                    <Stack
                      key={item.key}
                      direction="row"
                      spacing={1}
                      alignItems="flex-start"
                      sx={{
                        border: 1,
                        borderColor: done ? 'success.light' : 'divider',
                        borderRadius: 1,
                        p: 1,
                      }}
                    >
                      <Checkbox
                        size="small"
                        checked={done}
                        disabled={locked || hasLink}
                        onChange={e =>
                          setChecked({
                            ...checked,
                            [item.key]: e.target.checked,
                          })
                        }
                        sx={{ p: 0.5 }}
                      />
                      <Box>
                        <Typography variant="body2">{item.label}</Typography>
                        {item.hint && (
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', display: 'block' }}
                          >
                            {item.hint}
                          </Typography>
                        )}
                        {!locked && (
                          <Button
                            size="small"
                            startIcon={<AddIcon />}
                            onClick={() =>
                              setLinks([
                                ...links,
                                { title: item.label, url: '', check: item.key },
                              ])
                            }
                            sx={{ textTransform: 'none', px: 0 }}
                          >
                            Attach link
                          </Button>
                        )}
                      </Box>
                    </Stack>
                  )
                })}
              </Box>
            </Box>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
              gap: 2,
            }}
          >
            <Num
              label="Hours worked"
              value={f.hours_worked}
              onChange={v => setF({ ...f, hours_worked: v })}
              disabled={locked}
            />
            <Num
              label="Customer interviews"
              value={f.customer_interviews}
              onChange={v => setF({ ...f, customer_interviews: v })}
              disabled={locked}
            />
            <Num
              label="Features shipped"
              value={f.features_shipped}
              onChange={v => setF({ ...f, features_shipped: v })}
              disabled={locked}
            />
            <Num
              label="Revenue (₹)"
              value={f.revenue}
              onChange={v => setF({ ...f, revenue: v })}
              disabled={locked}
            />
            <Num
              label="Users acquired"
              value={f.users_acquired}
              onChange={v => setF({ ...f, users_acquired: v })}
              disabled={locked}
            />
            <Num
              label="Experiments run"
              value={f.experiments_run}
              onChange={v => setF({ ...f, experiments_run: v })}
              disabled={locked}
            />
          </Box>

          <Area
            label="Progress summary — what did you do these two weeks?"
            value={f.progress_summary}
            onChange={v => setF({ ...f, progress_summary: v })}
            disabled={locked}
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
              gap: 2,
            }}
          >
            <Area
              label="Wins"
              value={f.wins}
              onChange={v => setF({ ...f, wins: v })}
              disabled={locked}
            />
            <Area
              label="Blockers / what failed"
              value={f.blockers}
              onChange={v => setF({ ...f, blockers: v })}
              disabled={locked}
            />
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
              gap: 2,
            }}
          >
            <TextField
              label="Mentor meeting date"
              type="date"
              size="small"
              value={f.mentor_meeting_date ?? ''}
              disabled={locked}
              slotProps={{ inputLabel: { shrink: true } }}
              onChange={e =>
                setF({ ...f, mentor_meeting_date: e.target.value })
              }
            />
            <Area
              label="Mentor meeting notes"
              value={f.mentor_meeting_notes}
              onChange={v => setF({ ...f, mentor_meeting_notes: v })}
              disabled={locked}
            />
          </Box>

          <Box>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 1 }}
            >
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                Evidence links
              </Typography>
              {!locked && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => setLinks([...links, { title: '', url: '' }])}
                >
                  Add link
                </Button>
              )}
            </Stack>
            {links.length === 0 && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                No evidence links yet. Add call recordings, demo videos,
                screenshots, or docs.
              </Typography>
            )}
            <Stack spacing={1}>
              {links.map((l, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  {l.check && (
                    <Chip size="small" label="req" variant="outlined" />
                  )}
                  <TextField
                    size="small"
                    placeholder="Title"
                    value={l.title}
                    disabled={locked}
                    fullWidth
                    onChange={e =>
                      setLinks(
                        links.map((x, j) =>
                          j === i ? { ...x, title: e.target.value } : x
                        )
                      )
                    }
                  />
                  <TextField
                    size="small"
                    placeholder="https://"
                    value={l.url}
                    disabled={locked}
                    fullWidth
                    onChange={e =>
                      setLinks(
                        links.map((x, j) =>
                          j === i ? { ...x, url: e.target.value } : x
                        )
                      )
                    }
                  />
                  {!locked && (
                    <IconButton
                      size="small"
                      onClick={() => setLinks(links.filter((_, j) => j !== i))}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              ))}
            </Stack>
          </Box>

          <Area
            label="Goals for next cycle"
            value={f.goals_next_cycle}
            onChange={v => setF({ ...f, goals_next_cycle: v })}
            disabled={locked}
          />
          <Area
            label="Where do you need help?"
            value={f.ask_for_help}
            onChange={v => setF({ ...f, ask_for_help: v })}
            disabled={locked}
          />

          {isAdmin ? (
            <Alert severity="info">
              {submitted
                ? `Submission received from ${
                    existing?.submitted_by?.username
                      ? `${existing.submitted_by.username} (on behalf of venture)`
                      : 'venture team'
                  } on ${new Date(
                    existing.submitted_at
                  ).toLocaleDateString()}. Admin view is read-only.`
                : 'Venture team has not submitted for this cycle yet.'}
            </Alert>
          ) : (
            <>
              {existing?.submitted_by?.username && (
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', display: 'block', mb: 1 }}
                >
                  Last saved/submitted by co-founder:{' '}
                  <strong>{existing.submitted_by.username}</strong>
                </Typography>
              )}
              {!locked && (
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  flexWrap="wrap"
                  gap={1}
                >
                  <Typography variant="caption" sx={{ color: 'warning.main' }}>
                    {requiredCount > 0 &&
                      doneCount < requiredCount &&
                      `${requiredCount - doneCount} required item${
                        requiredCount - doneCount > 1 ? 's' : ''
                      } still missing.`}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => save(false)}
                    >
                      Save draft
                    </Button>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={!f.progress_summary}
                      onClick={() => save(true)}
                    >
                      Submit cycle {cycleNumber}
                    </Button>
                  </Stack>
                </Stack>
              )}

              {locked && !submitted && (
                <Alert severity="error" icon={<LockIcon />}>
                  Deadline passed on {deadline.toLocaleDateString()}. Contact
                  faculty to reopen.
                </Alert>
              )}
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

/* =========== Mentor observations =========== */
function MentorObservationSection({
  cycleNumber,
  submission,
  observation,
  canAuthor,
  onSave,
}) {
  const evidenceLinks = Array.isArray(submission?.evidence_links)
    ? submission.evidence_links
    : []

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>
          Mentor observation · Cycle {cycleNumber}
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {!observation && !canAuthor && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No mentor observations for this cycle yet.
            </Typography>
          )}
          {observation && (
            <Box
              sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
            >
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {new Date(
                  observation.updated_at ?? observation.created_at
                ).toLocaleString()}
              </Typography>
              <Typography
                variant="body2"
                sx={{ whiteSpace: 'pre-wrap', my: 1 }}
              >
                {observation.observation}
              </Typography>
              {observation.strengths && (
                <Typography variant="body2">
                  <strong>Strengths:</strong> {observation.strengths}
                </Typography>
              )}
              {observation.concerns && (
                <Typography variant="body2">
                  <strong>Concerns:</strong> {observation.concerns}
                </Typography>
              )}
              {observation.action_items && (
                <Typography variant="body2">
                  <strong>Action items:</strong> {observation.action_items}
                </Typography>
              )}
              {Array.isArray(observation.evidence_reviewed) &&
                observation.evidence_reviewed.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary', display: 'block' }}
                    >
                      Evidence reviewed:
                    </Typography>
                    {observation.evidence_reviewed.map((idx, i) => {
                      const link = evidenceLinks[idx]
                      if (!link) return null
                      return (
                        <Stack
                          key={i}
                          direction="row"
                          spacing={0.5}
                          alignItems="center"
                        >
                          <OpenInNewIcon fontSize="inherit" />
                          {link.url ? (
                            <Link
                              href={link.url}
                              target="_blank"
                              rel="noreferrer"
                              variant="body2"
                            >
                              {link.title || link.url}
                            </Link>
                          ) : (
                            <Typography
                              variant="body2"
                              sx={{ color: 'text.secondary' }}
                            >
                              {link.title}
                            </Typography>
                          )}
                        </Stack>
                      )
                    })}
                  </Box>
                )}
            </Box>
          )}

          {canAuthor && (
            <ObservationForm
              cycleNumber={cycleNumber}
              existing={observation}
              evidenceLinks={evidenceLinks}
              onSave={onSave}
            />
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

function ObservationForm({ cycleNumber, existing, evidenceLinks, onSave }) {
  const [open, setOpen] = React.useState(false)
  const [f, setF] = React.useState({
    observation: existing?.observation ?? '',
    strengths: existing?.strengths ?? '',
    concerns: existing?.concerns ?? '',
    action_items: existing?.action_items ?? '',
  })
  const [reviewed, setReviewed] = React.useState(
    Array.isArray(existing?.evidence_reviewed) ? existing.evidence_reviewed : []
  )
  const [error, setError] = React.useState('')

  const save = () => {
    if (!f.observation.trim()) {
      setError('Observation notes are required.')
      return
    }
    setError('')
    onSave({
      cycle_number: cycleNumber,
      ...f,
      evidence_reviewed: reviewed,
    })
    setOpen(false)
  }

  if (!open) {
    return (
      <Box>
        <Button size="small" variant="outlined" onClick={() => setOpen(true)}>
          {existing ? 'Edit observation' : 'Add observation'}
        </Button>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        border: 1,
        borderStyle: 'dashed',
        borderColor: 'divider',
        borderRadius: 1,
        p: 2,
      }}
    >
      <Stack spacing={2}>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>
          {existing ? 'Edit your observation' : 'New observation'}
        </Typography>
        <Area
          label="Observation (required)"
          value={f.observation}
          onChange={v => setF({ ...f, observation: v })}
        />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
            gap: 2,
          }}
        >
          <Area
            label="Strengths"
            value={f.strengths}
            onChange={v => setF({ ...f, strengths: v })}
          />
          <Area
            label="Concerns"
            value={f.concerns}
            onChange={v => setF({ ...f, concerns: v })}
          />
        </Box>
        <Area
          label="Action items for founder"
          value={f.action_items}
          onChange={v => setF({ ...f, action_items: v })}
        />

        {evidenceLinks.length > 0 && (
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Link to reviewed evidence
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                gap: 1,
              }}
            >
              {evidenceLinks.map((l, i) => {
                const isChecked = reviewed.includes(i)
                return (
                  <Stack
                    key={i}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{
                      border: 1,
                      borderColor: isChecked ? 'primary.main' : 'divider',
                      borderRadius: 1,
                      px: 1,
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={isChecked}
                      onChange={e =>
                        setReviewed(
                          e.target.checked
                            ? [...reviewed, i]
                            : reviewed.filter(x => x !== i)
                        )
                      }
                    />
                    <Typography variant="body2" noWrap>
                      {l.title || l.url || `Item ${i + 1}`}
                    </Typography>
                  </Stack>
                )
              })}
            </Box>
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="small" variant="contained" onClick={save}>
            Save observation
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}

function Num({ label, value, onChange, disabled }) {
  return (
    <TextField
      label={label}
      type="number"
      size="small"
      value={value}
      disabled={disabled}
      onChange={e => onChange(Number(e.target.value))}
    />
  )
}

function Area({ label, value, onChange, disabled }) {
  return (
    <TextField
      label={label}
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      multiline
      rows={3}
      fullWidth
      size="small"
    />
  )
}

function EvaluationSection({ cycleNumber, evaluation, canAuthor, onSave }) {
  const monthNumber = Math.ceil(cycleNumber / 2)
  const [open, setOpen] = React.useState(false)
  const [scores, setScores] = React.useState({
    execution_score: evaluation?.execution_score ?? 0,
    customer_score: evaluation?.customer_score ?? 0,
    business_score: evaluation?.business_score ?? 0,
    behavior_score: evaluation?.behavior_score ?? 0,
  })

  const totalScore =
    (Number(scores.execution_score) || 0) +
    (Number(scores.customer_score) || 0) +
    (Number(scores.business_score) || 0) +
    (Number(scores.behavior_score) || 0)

  const derivedStatus =
    totalScore >= 75 ? 'green' : totalScore >= 50 ? 'yellow' : 'red'

  const handleSave = () => {
    onSave({
      checklist_id: cycleNumber,
      month_number: monthNumber,
      year: new Date().getFullYear(),
      execution_score: Number(scores.execution_score) || 0,
      customer_score: Number(scores.customer_score) || 0,
      business_score: Number(scores.business_score) || 0,
      behavior_score: Number(scores.behavior_score) || 0,
      total_score: totalScore,
      status: derivedStatus,
    })
    setOpen(false)
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={1}
        >
          <Box>
            <Typography variant="h6">
              Cycle {cycleNumber} Evaluation (Month {monthNumber})
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Faculty pillar assessment (0–100 per pillar)
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {evaluation ? (
              <Chip
                size="small"
                label={`Score: ${evaluation.total_score ?? totalScore} (${
                  evaluation.status ?? derivedStatus
                })`}
                color={
                  STATUS_COLOR[evaluation.status ?? derivedStatus] || 'default'
                }
                variant="outlined"
              />
            ) : (
              <Chip size="small" label="Not evaluated" variant="outlined" />
            )}
            {canAuthor && (
              <Button
                size="small"
                variant={open ? 'outlined' : 'contained'}
                onClick={() => setOpen(!open)}
              >
                {open
                  ? 'Close'
                  : evaluation
                    ? 'Edit evaluation'
                    : 'Add evaluation'}
              </Button>
            )}
          </Stack>
        </Stack>

        {open && canAuthor ? (
          <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, 1fr)' },
                gap: 2,
                mb: 2,
              }}
            >
              <TextField
                label="Execution (0-100)"
                type="number"
                size="small"
                slotProps={{ htmlInput: { min: 0, max: 100 } }}
                value={scores.execution_score}
                onChange={e =>
                  setScores({ ...scores, execution_score: e.target.value })
                }
              />
              <TextField
                label="Customer (0-100)"
                type="number"
                size="small"
                slotProps={{ htmlInput: { min: 0, max: 100 } }}
                value={scores.customer_score}
                onChange={e =>
                  setScores({ ...scores, customer_score: e.target.value })
                }
              />
              <TextField
                label="Business (0-100)"
                type="number"
                size="small"
                slotProps={{ htmlInput: { min: 0, max: 100 } }}
                value={scores.business_score}
                onChange={e =>
                  setScores({ ...scores, business_score: e.target.value })
                }
              />
              <TextField
                label="Behavior (0-100)"
                type="number"
                size="small"
                slotProps={{ htmlInput: { min: 0, max: 100 } }}
                value={scores.behavior_score}
                onChange={e =>
                  setScores({ ...scores, behavior_score: e.target.value })
                }
              />
            </Box>

            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              flexWrap="wrap"
              gap={1}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Total: {totalScore} / 400 · Status:{' '}
                <Box
                  component="span"
                  sx={{
                    textTransform: 'capitalize',
                    color: `${STATUS_COLOR[derivedStatus]}.main`,
                  }}
                >
                  {derivedStatus}
                </Box>
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="small" variant="contained" onClick={handleSave}>
                  Save Evaluation
                </Button>
              </Stack>
            </Stack>
          </Box>
        ) : evaluation ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, 1fr)',
                sm: 'repeat(4, 1fr)',
              },
              gap: 2,
              mt: 2,
              pt: 2,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Stat label="Execution" value={evaluation.execution_score ?? 0} />
            <Stat label="Customer" value={evaluation.customer_score ?? 0} />
            <Stat label="Business" value={evaluation.business_score ?? 0} />
            <Stat label="Behavior" value={evaluation.behavior_score ?? 0} />
          </Box>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default BiWeekly
