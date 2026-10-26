import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import CheckIn from '../models/checkIn.js'
import Founder from '../models/founder.js'
import KPI from '../models/kpi.js'
import User from '../models/user.js'
import {
  extractCheckInKpis,
  matchSpeaker,
  setKpiExtractor,
  speakerAccounts,
} from '../utils/kpiBot.js'
import request from 'supertest'

import app from '../app.js'
import { cookieFor, seed, startDatabase, stopDatabase } from './helpers.js'

// Alpha: mentored by Mo Mentor, founded by Olu Owner and Vansh Dagar, who
// shows up in Meet as "vansh K". Oz Outsider founds Beta.
let data
let vansh
let calls

const TEXT = [
  '[00:00] Mo Mentor: Can you triple your users in 20 days?',
  '[00:10] Olu Owner: Yes, we will reach 200 users by the 8th.',
  '[00:20] vansh K: We will show them version one by this week end.',
  '[00:30] Oz Outsider: We will close two pilots.',
].join('\n')

const ENTRIES = TEXT.split('\n').map(line => ({
  speaker: line.slice(8, line.indexOf(': ')),
  text: line.slice(line.indexOf(': ') + 2),
}))

const goal = (speaker, quote, extra = {}) => ({
  speaker,
  title: `Goal for ${speaker}`,
  description: 'A goal.',
  targetValue: '',
  dueDate: '',
  quote,
  ...extra,
})

const GOALS = [
  goal('Olu Owner', 'Yes, we will reach 200 users by the 8th.', {
    targetValue: '200 users',
    dueDate: '2026-11-08',
  }),
  goal('vansh K', 'We will show them version one by this week end.'),
  goal('Oz Outsider', 'We will close two pilots.'),
  goal('Olu Owner', 'A quote the model made up.'),
]

const fake =
  (kpis = GOALS) =>
  async input => {
    calls.push(input)
    return kpis
  }

// A held check-in of Alpha's on 19 October with its transcript ready.
const readyCheckIn = (fields = {}) =>
  CheckIn.create({
    venture: data.ventures.alpha._id,
    mentor: data.users.mentor._id,
    scheduledAt: new Date('2026-10-19T07:30:00Z'),
    durationMinutes: 90,
    timeZone: 'Asia/Kolkata',
    googleEventId: 'event1',
    status: 'HELD',
    transcript: { status: 'READY', text: TEXT, entries: ENTRIES },
    ...fields,
  })

before(startDatabase)
after(async () => {
  setKpiExtractor(null)
  await stopDatabase()
})
beforeEach(async () => {
  data = await seed()
  vansh = await User.create({
    username: 'Vansh Dagar',
    email: 'vansh.k@adypu.edu.in',
    password: 'password123',
    role: data.users.owner.role,
  })
  await Founder.create({ user: vansh._id, venture: data.ventures.alpha._id })
  calls = []
  setKpiExtractor(fake())
})

describe('matching speakers to founders', () => {
  const founders = () =>
    Founder.find({ venture: data.ventures.alpha._id })
      .populate('user', 'username email googleId')
      .lean()

  it('matches by name, then by email username', async () => {
    const alpha = await founders()
    assert.equal(
      matchSpeaker('olu  owner', alpha).founder.user.username,
      'Olu Owner'
    )
    assert.equal(
      matchSpeaker('vansh K', alpha).founder.user.username,
      'Vansh Dagar'
    )
    assert.equal(
      matchSpeaker('Oz Outsider', alpha).reason,
      'Not a founder of this startup'
    )
  })

  it('matches a signed-in speaker by Google account, not by name', async () => {
    await User.updateOne({ _id: vansh._id }, { googleId: 'vansh-id' })
    await User.updateOne({ _id: data.users.owner._id }, { googleId: 'olu-id' })
    const alpha = await founders()
    const accounts = speakerAccounts([
      // Vansh shows up under a name nobody could guess.
      { speaker: 'Pixel Phone', googleId: 'vansh-id' },
      // Someone else named Olu Owner, from another account.
      { speaker: 'Olu Owner', googleId: 'stranger-id' },
    ])
    assert.equal(
      matchSpeaker('pixel phone', alpha, accounts).founder.user.username,
      'Vansh Dagar'
    )
    assert.equal(
      matchSpeaker('Olu Owner', alpha, accounts).reason,
      "Spoke from a Google account that isn't the founder's"
    )
    // A guest (no account) is still matched by name.
    assert.equal(
      matchSpeaker('Olu Owner', alpha).founder.user.username,
      'Olu Owner'
    )
  })

  it('matches a signed-in speaker by name when the founder has no Google account', async () => {
    await User.updateOne(
      { _id: data.users.owner._id },
      { $unset: { googleId: 1 } }
    )
    const alpha = await founders()
    const accounts = speakerAccounts([
      { speaker: 'Olu Owner', googleId: 'some-id' },
    ])
    assert.equal(
      matchSpeaker('Olu Owner', alpha, accounts).founder.user.username,
      'Olu Owner'
    )
  })
})

describe('extracting KPIs from transcripts', () => {
  it("adds draft founder KPIs and reports goals it can't place", async () => {
    const checkIn = await readyCheckIn()
    assert.deepEqual(await extractCheckInKpis(), { done: 1, failed: 0 })

    // Gemini hears about Alpha's founders only.
    assert.deepEqual(calls[0].founders.map(f => f.user.username).sort(), [
      'Olu Owner',
      'Vansh Dagar',
    ])
    assert.equal(calls[0].meetingDate, '2026-10-19')

    const kpis = await KPI.find({ scope: 'FOUNDER' }).sort({ title: 1 }).lean()
    assert.deepEqual(
      kpis.map(k => [k.title, String(k.founder)]),
      [
        ['Goal for Olu Owner', String(data.users.owner._id)],
        ['Goal for vansh K', String(vansh._id)],
      ]
    )
    const [olu] = kpis
    assert.equal(olu.scope, 'FOUNDER')
    assert.equal(olu.status, 'DRAFT')
    assert.equal(String(olu.venture), String(data.ventures.alpha._id))
    assert.equal(String(olu.createdBy), String(data.users.mentor._id))
    assert.equal(olu.targetValue, '200 users')
    assert.equal(olu.dueDate.toISOString(), '2026-11-08T18:29:59.999Z')
    assert.match(olu.description, /\nMeeting: 2026-10-19\n/)

    const run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    assert.equal(run.status, 'DONE')
    assert.equal(run.created, 2)
    // Oz's goal is left for Beta's own check-in.
    assert.deepEqual(
      run.skipped.map(s => s.reason),
      ['Quote not found in the transcript']
    )
  })

  it('handles each check-in once', async () => {
    await readyCheckIn()
    await extractCheckInKpis()
    assert.deepEqual(await extractCheckInKpis(), { done: 0, failed: 0 })
    assert.equal(calls.length, 1)
    assert.equal(await KPI.countDocuments({ scope: 'FOUNDER' }), 2)
  })

  it("doesn't ask Gemini when no founder of the startup spoke", async () => {
    const checkIn = await readyCheckIn({
      transcript: {
        status: 'READY',
        text: '[00:00] Mo Mentor: Hello.',
        entries: [{ speaker: 'Mo Mentor', text: 'Hello.' }],
      },
    })
    await extractCheckInKpis()
    assert.equal(calls.length, 0)
    assert.equal(
      (await CheckIn.findById(checkIn._id)).kpiExtraction.status,
      'SKIPPED'
    )
  })

  it('waits for the transcript', async () => {
    await readyCheckIn({ transcript: { status: 'PENDING' } })
    assert.deepEqual(await extractCheckInKpis(), { done: 0, failed: 0 })
    assert.equal(calls.length, 0)
  })

  it('leaves a meeting alone when its KPIs already exist', async () => {
    await KPI.create({
      title: 'Imported earlier',
      description: 'Done by hand\n\nMeeting: 2026-10-19\nFrom the transcript',
      venture: data.ventures.alpha._id,
      createdBy: data.users.mentor._id,
    })
    const checkIn = await readyCheckIn()
    await extractCheckInKpis()
    assert.equal(calls.length, 0)
    assert.equal(
      (await CheckIn.findById(checkIn._id)).kpiExtraction.status,
      'SKIPPED'
    )
  })

  it('retries a failure after ten minutes', async () => {
    const down = async () => {
      throw new Error('Gemini is down')
    }
    const at = minutes => ({ now: new Date(Date.now() + minutes * 60 * 1000) })
    setKpiExtractor(down)
    const checkIn = await readyCheckIn()
    assert.deepEqual(await extractCheckInKpis(at(0)), { done: 0, failed: 1 })
    let run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    assert.equal(run.status, 'FAILED')
    assert.equal(run.error, 'Gemini is down')

    setKpiExtractor(fake())
    assert.deepEqual(await extractCheckInKpis(at(5)), { done: 0, failed: 0 })
    assert.deepEqual(await extractCheckInKpis(at(11)), { done: 1, failed: 0 })
    run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    assert.equal(run.status, 'DONE')
    assert.equal(run.attempts, 2)
  })

  it('is off without a Gemini key', async () => {
    setKpiExtractor(null)
    const { GEMINI_API_KEY: key } = process.env
    delete process.env.GEMINI_API_KEY
    await readyCheckIn()
    const result = await extractCheckInKpis()
    Object.assign(process.env, key ? { GEMINI_API_KEY: key } : {})
    assert.deepEqual(result, { done: 0, failed: 0 })
  })
})

describe('failures part way through', () => {
  const minutesLater = minutes => ({
    now: new Date(Date.now() + minutes * 60 * 1000),
  })

  it(
    "times out a Gemini call that never answers, so other jobs aren't blocked",
    { timeout: 5000 },
    async () => {
      setKpiExtractor(() => new Promise(() => {}), { timeoutMs: 50 })
      const checkIn = await readyCheckIn()
      assert.deepEqual(await extractCheckInKpis(), { done: 0, failed: 1 })
      const run = (await CheckIn.findById(checkIn._id)).kpiExtraction
      assert.equal(run.status, 'FAILED')
      assert.match(run.error, /timed out/)
    }
  )

  it('skips a malformed goal instead of failing the meeting', async () => {
    setKpiExtractor(
      fake([
        GOALS[0],
        { ...GOALS[1], description: null },
        { ...GOALS[1], title: 7 },
        'not a goal',
      ])
    )
    const checkIn = await readyCheckIn()
    assert.deepEqual(await extractCheckInKpis(), { done: 1, failed: 0 })
    const run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    assert.equal(run.status, 'DONE')
    assert.equal(run.created, 1)
    assert.equal(run.skipped.length, 3)
  })

  it('finishes a half-saved meeting on retry without asking Gemini again', async t => {
    // The database fails on the second KPI of the first try.
    const realUpdateOne = KPI.updateOne.bind(KPI)
    let saves = 0
    const hiccup = t.mock.method(KPI, 'updateOne', (...args) => {
      saves++
      if (saves === 2) {
        throw new Error('Database hiccup')
      }
      return realUpdateOne(...args)
    })
    const checkIn = await readyCheckIn()
    assert.deepEqual(await extractCheckInKpis(minutesLater(0)), {
      done: 0,
      failed: 1,
    })
    assert.equal(await KPI.countDocuments({ scope: 'FOUNDER' }), 1)
    hiccup.mock.restore()

    assert.deepEqual(await extractCheckInKpis(minutesLater(11)), {
      done: 1,
      failed: 0,
    })
    const run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    assert.equal(run.status, 'DONE')
    assert.equal(run.created, 2)
    assert.equal(calls.length, 1)
    assert.equal(await KPI.countDocuments({ scope: 'FOUNDER' }), 2)
  })

  it("doesn't overwrite a result another server saved after its lease ran out", async () => {
    const checkIn = await readyCheckIn()
    setKpiExtractor(async () => {
      // Meanwhile another server took the check-in over and finished it.
      await CheckIn.updateOne(
        { _id: checkIn._id },
        {
          $set: {
            'kpiExtraction.status': 'DONE',
            'kpiExtraction.created': 99,
            'kpiExtraction.leaseUntil': null,
          },
        }
      )
      return GOALS
    })
    await extractCheckInKpis()
    const run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    assert.equal(run.created, 99)
  })

  it('counts a goal Gemini repeats once', async () => {
    setKpiExtractor(fake([GOALS[0], GOALS[0]]))
    const checkIn = await readyCheckIn()
    await extractCheckInKpis()
    assert.equal((await CheckIn.findById(checkIn._id)).kpiExtraction.created, 1)
    assert.equal(await KPI.countDocuments({ scope: 'FOUNDER' }), 1)
  })
})

describe('checking what Gemini says', () => {
  const runFor = async kpis => {
    setKpiExtractor(fake(kpis))
    const checkIn = await readyCheckIn()
    await extractCheckInKpis()
    return (await CheckIn.findById(checkIn._id)).kpiExtraction
  }

  it("won't give a founder a goal another startup's founder said", async () => {
    const run = await runFor([
      goal('Olu Owner', 'We will close two pilots.'),
      // The mentor assigning a goal is fine.
      goal('Olu Owner', 'Can you triple your users in 20 days?'),
    ])
    assert.equal(run.created, 1)
    assert.deepEqual(
      run.skipped.map(s => s.reason),
      ["Quote is from another startup's founder"]
    )
  })

  it('needs a quote long enough to back the goal', async () => {
    const run = await runFor([goal('Olu Owner', 'Yes,')])
    assert.equal(run.created, 0)
    assert.deepEqual(
      run.skipped.map(s => s.reason),
      ['Quote too short to back a KPI']
    )
  })

  it('drops a due date before the meeting', async () => {
    await runFor([{ ...GOALS[0], dueDate: '2026-10-01' }])
    const [kpi] = await KPI.find({ scope: 'FOUNDER' }).lean()
    assert.equal(kpi.dueDate ?? null, null)
  })

  it('uses the title when a goal has no description', async () => {
    await runFor([{ ...GOALS[0], description: '' }])
    const [kpi] = await KPI.find({ scope: 'FOUNDER' }).lean()
    assert.ok(kpi.description.startsWith('Goal for Olu Owner\n\nMeeting:'))
  })

  it('spots a meeting whose KPI description starts with its date', async () => {
    await KPI.create({
      title: 'Imported earlier',
      description: 'Meeting: 2026-10-19\nShip the pilot',
      venture: data.ventures.alpha._id,
      createdBy: data.users.mentor._id,
    })
    const checkIn = await readyCheckIn()
    await extractCheckInKpis()
    assert.equal(calls.length, 0)
    assert.equal(
      (await CheckIn.findById(checkIn._id)).kpiExtraction.status,
      'SKIPPED'
    )
  })

  it('skips a ready transcript that has no text', async () => {
    const checkIn = await readyCheckIn({
      transcript: { status: 'READY', entries: ENTRIES },
    })
    assert.deepEqual(await extractCheckInKpis(), { done: 1, failed: 0 })
    assert.equal(calls.length, 0)
    assert.equal(
      (await CheckIn.findById(checkIn._id)).kpiExtraction.status,
      'SKIPPED'
    )
  })

  it('leases each check-in from when it is taken, not when the pass began', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
    const leases = []
    setKpiExtractor(async ({ text }) => {
      const current = await CheckIn.findOne({ 'transcript.text': text })
        .sort({ 'kpiExtraction.leaseUntil': -1 })
        .lean()
      // A full ten minutes from when it was taken.
      leases.push(
        current.kpiExtraction.leaseUntil.getTime() - Date.now() >=
          10 * 60 * 1000
      )
      // Each Gemini call takes three and a half minutes.
      t.mock.timers.tick(3.5 * 60 * 1000)
      return []
    })
    await readyCheckIn()
    await readyCheckIn({
      googleEventId: 'event2',
      scheduledAt: new Date('2026-11-02T07:30:00Z'),
    })
    await extractCheckInKpis()
    assert.deepEqual(leases, [true, true])
  })
})

describe('review findings', () => {
  it("stops taking check-ins after four minutes, so other jobs aren't held up", async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
    setKpiExtractor(async input => {
      calls.push(input)
      // Each Gemini call takes three minutes.
      t.mock.timers.tick(3 * 60 * 1000)
      return []
    })
    for (const day of ['19', '20', '21']) {
      await readyCheckIn({
        googleEventId: `event-${day}`,
        scheduledAt: new Date(`2026-10-${day}T07:30:00Z`),
      })
    }
    assert.deepEqual(await extractCheckInKpis(), { done: 2, failed: 0 })
    assert.equal(calls.length, 2)
  })

  it("dates the meeting and its deadlines in the check-in's time zone", async () => {
    // 21:00 in London on 19 October, already the 20th in India.
    const checkIn = await readyCheckIn({
      timeZone: 'Europe/London',
      scheduledAt: new Date('2026-10-19T20:00:00Z'),
    })
    await extractCheckInKpis()
    assert.equal(calls[0].meetingDate, '2026-10-19')
    const kpi = await KPI.findOne({ founder: data.users.owner._id }).lean()
    // London is back on GMT by 8 November.
    assert.equal(kpi.dueDate.toISOString(), '2026-11-08T23:59:59.999Z')
    assert.match(kpi.description, /\nMeeting: 2026-10-19\n/)
    assert.ok(checkIn)
  })

  it("keeps the bot's working state out of the check-in API", async () => {
    const checkIn = await readyCheckIn({
      attendees: [
        { user: data.users.owner._id, email: data.users.owner.email },
      ],
    })
    await extractCheckInKpis()
    const as = user => url =>
      request(app).get(url).set('Cookie', cookieFor(user))
    const one = await as(data.users.owner)(`/api/checkins/${checkIn._id}`)
    assert.equal(one.status, 200)
    assert.equal(one.body.checkIn.kpiExtraction, undefined)
    const list = await as(data.users.owner)('/api/checkins')
    assert.ok(list.body.checkIns.length)
    for (const listed of list.body.checkIns) {
      assert.equal(listed.kpiExtraction, undefined)
    }
  })

  it('names a quote spanning two lines as such', async () => {
    setKpiExtractor(
      fake([
        goal(
          'Olu Owner',
          'users by the 8th.\n[00:20] vansh K: We will show them'
        ),
      ])
    )
    const checkIn = await readyCheckIn()
    await extractCheckInKpis()
    const run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    assert.deepEqual(
      run.skipped.map(s => s.reason),
      ['Quote must come from one line of the transcript']
    )
  })

  it('asks Gemini once for a group session and shares out the goals', async () => {
    const group = { group: true, googleEventId: 'group-event' }
    const alpha = await readyCheckIn(group)
    const beta = await readyCheckIn({
      ...group,
      venture: data.ventures.beta._id,
    })
    await extractCheckInKpis()
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].founders.map(f => f.user.username).sort(), [
      'Olu Owner',
      'Oz Outsider',
      'Vansh Dagar',
    ])
    const runOf = async id => (await CheckIn.findById(id)).kpiExtraction
    assert.equal((await runOf(alpha._id)).created, 2)
    assert.equal((await runOf(beta._id)).created, 1)
    const [oz] = await KPI.find({ founder: data.users.outsider._id }).lean()
    assert.equal(String(oz.venture), String(data.ventures.beta._id))
  })

  it('caps the length of what Gemini wrote before keeping it', async () => {
    setKpiExtractor(fake([{ ...GOALS[0], description: 'x'.repeat(50000) }]))
    const checkIn = await readyCheckIn()
    await extractCheckInKpis()
    const run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    assert.ok(run.candidates[0].description.length <= 2000)
    assert.equal(run.created, 1)
  })
})

describe('Google accounts in the transcript', () => {
  it('gives a goal to the founder whose Google account spoke', async () => {
    await User.updateOne({ _id: vansh._id }, { googleId: 'vansh-id' })
    const text = '[00:00] Pixel Phone: We will ship version one this week.'
    setKpiExtractor(
      fake([goal('Pixel Phone', 'We will ship version one this week.')])
    )
    await readyCheckIn({
      transcript: {
        status: 'READY',
        text,
        entries: [
          {
            speaker: 'Pixel Phone',
            googleId: 'vansh-id',
            text: 'We will ship version one this week.',
          },
        ],
      },
    })
    await extractCheckInKpis()
    // Gemini is told who the speaker is.
    assert.deepEqual(calls[0].identified, [
      { speaker: 'Pixel Phone', email: 'vansh.k@adypu.edu.in' },
    ])
    const [kpi] = await KPI.find({ scope: 'FOUNDER' }).lean()
    assert.equal(String(kpi.founder), String(vansh._id))
  })

  it("won't give a goal to a lookalike from another account", async () => {
    await User.updateOne({ _id: data.users.owner._id }, { googleId: 'olu-id' })
    const checkIn = await readyCheckIn({
      transcript: {
        status: 'READY',
        text: TEXT,
        entries: ENTRIES.map(entry => ({
          ...entry,
          googleId: 'x-' + entry.speaker,
        })),
      },
    })
    await extractCheckInKpis()
    const run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    // Vansh has no Google account here, so his name still counts.
    assert.equal(run.created, 1)
    assert.ok(
      run.skipped.some(
        s => s.reason === "Spoke from a Google account that isn't the founder's"
      )
    )
  })
})

describe('bug check', () => {
  it("won't pick between two people who spoke under the same name", async () => {
    await User.updateOne({ _id: data.users.owner._id }, { googleId: 'olu-id' })
    const said = 'Yes, we will reach 200 users by the 8th.'
    setKpiExtractor(fake([goal('Olu Owner', said)]))
    const checkIn = await readyCheckIn({
      transcript: {
        status: 'READY',
        text: `[00:00] Olu Owner: ${said}`,
        entries: [
          { speaker: 'Olu Owner', googleId: 'olu-id', text: 'Hello.' },
          { speaker: 'Olu Owner', googleId: 'other-olu', text: said },
        ],
      },
    })
    await extractCheckInKpis()
    const run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    // Olu did speak, so the meeting is gone through, not skipped.
    assert.equal(run.status, 'DONE')
    assert.equal(run.created, 0)
    assert.deepEqual(
      run.skipped.map(s => s.reason),
      ['Several people spoke under this name']
    )
    // Gemini isn't told this name is Olu.
    assert.deepEqual(calls[0].identified, [])
  })

  it("keeps speakers' Google account IDs out of the check-in API", async () => {
    const checkIn = await readyCheckIn({
      attendees: [
        { user: data.users.owner._id, email: data.users.owner.email },
      ],
      transcript: {
        status: 'READY',
        text: TEXT,
        entries: ENTRIES.map(entry => ({ ...entry, googleId: 'some-id' })),
      },
    })
    const res = await request(app)
      .get(`/api/checkins/${checkIn._id}`)
      .set('Cookie', cookieFor(data.users.owner))
    assert.equal(res.status, 200)
    assert.equal(res.body.checkIn.transcript.entries.length, ENTRIES.length)
    for (const entry of res.body.checkIn.transcript.entries) {
      assert.equal(entry.googleId, undefined)
    }
  })
})

describe('full review', () => {
  it('finds a quote when Gemini evens out the spacing', async () => {
    // Meet transcripts often have two spaces in a row; Gemini copies one.
    const text = '[00:10] Olu Owner: Yes,  we will reach  200 users by the 8th.'
    setKpiExtractor(
      fake([goal('Olu Owner', 'Yes, we will reach 200 users by the 8th.')])
    )
    const checkIn = await readyCheckIn({
      transcript: {
        status: 'READY',
        text,
        entries: [{ speaker: 'Olu Owner', text: text.slice(19) }],
      },
    })
    await extractCheckInKpis()
    const run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    assert.equal(run.created, 1)
    assert.deepEqual(run.skipped, [])
  })

  it('keeps retrying through a day-long Gemini outage', async () => {
    const down = async () => {
      throw new Error('Gemini is down')
    }
    const at = hours => ({ now: new Date(Date.now() + hours * 3600 * 1000) })
    setKpiExtractor(down)
    const checkIn = await readyCheckIn()
    // Tries over the first day all fail.
    for (const hours of [0, 0.2, 1.3, 7.4, 31.5]) {
      await extractCheckInKpis(at(hours))
    }
    let run = (await CheckIn.findById(checkIn._id)).kpiExtraction
    assert.equal(run.status, 'FAILED')
    assert.equal(run.attempts, 5)
    // No more tries after that.
    setKpiExtractor(fake())
    assert.deepEqual(await extractCheckInKpis(at(100)), { done: 0, failed: 0 })

    // A second check-in recovers once Gemini is back within a day.
    setKpiExtractor(down)
    const later = await readyCheckIn({
      googleEventId: 'event2',
      scheduledAt: new Date('2026-11-02T07:30:00Z'),
    })
    for (const hours of [200, 200.2, 201.3]) {
      await extractCheckInKpis(at(hours))
    }
    setKpiExtractor(fake())
    await extractCheckInKpis(at(207.4))
    run = (await CheckIn.findById(later._id)).kpiExtraction
    assert.equal(run.status, 'DONE')
  })

  it('handles a second meeting the same day', async () => {
    const morning = await readyCheckIn()
    await extractCheckInKpis()
    // The mentor's own check-in that afternoon.
    const afternoon = await readyCheckIn({
      googleEventId: 'event2',
      scheduledAt: new Date('2026-10-19T11:00:00Z'),
    })
    setKpiExtractor(
      fake([goal('Olu Owner', 'Can you triple your users in 20 days?')])
    )
    await extractCheckInKpis()
    const run = (await CheckIn.findById(afternoon._id)).kpiExtraction
    assert.equal(run.status, 'DONE')
    assert.equal(run.created, 1)
    assert.ok(morning)
  })
})
