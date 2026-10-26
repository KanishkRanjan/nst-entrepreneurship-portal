import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

import app from '../app.js'
import CheckIn from '../models/checkIn.js'
import { transcriptDueAt } from '../utils/checkInHelper.js'
import { GoogleError } from '../utils/googleWorkspace.js'
import { GIVE_UP_MS, pollTranscripts } from '../utils/transcriptPoller.js'
import {
  connectCalendar,
  cookieFor,
  google,
  seed,
  startDatabase,
  stopDatabase,
} from './helpers.js'

// Alpha: mentored by `mentor`, founded by `owner`.
let data
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const CODE = 'abc-defg-001'

const as = user => ({
  get: url => request(app).get(url).set('Cookie', cookieFor(user)),
  put: (url, body) =>
    request(app).put(url).set('Cookie', cookieFor(user)).send(body),
  post: url => request(app).post(url).set('Cookie', cookieFor(user)),
})

// A check-in of Alpha's that started `hoursAgo` and lasted 30 minutes.
const pastCheckIn = (hoursAgo, fields = {}) => {
  const scheduledAt = new Date(Date.now() - hoursAgo * HOUR_MS)
  return CheckIn.create({
    venture: data.ventures.alpha._id,
    mentor: data.users.mentor._id,
    scheduledAt,
    durationMinutes: 30,
    timeZone: 'Asia/Kolkata',
    googleEventId: 'event1',
    meetUrl: `https://meet.google.com/${CODE}`,
    meetingCode: CODE,
    attendees: [{ user: data.users.owner._id, email: data.users.owner.email }],
    transcript: { nextPollAt: transcriptDueAt(scheduledAt, 30) },
    ...fields,
  })
}

// Meet's record of a conference that started `minutesAfter` the check-in.
const addRecord = (checkIn, name, { minutesAfter = 2, ended = true } = {}) => {
  const start = checkIn.scheduledAt.getTime() + minutesAfter * MINUTE_MS
  google.records.push({
    name,
    meetingCode: CODE,
    startTime: new Date(start).toISOString(),
    ...(ended && { endTime: new Date(start + 28 * MINUTE_MS).toISOString() }),
  })
}

const addTranscript = (recordName, state = 'FILE_GENERATED') => {
  const name = `${recordName}/transcripts/t1`
  google.transcripts.set(recordName, [{ name, state }])
  google.participants.set(`${recordName}/participants/mo`, {
    signedinUser: { displayName: 'Mo Mentor' },
  })
  google.participants.set(`${recordName}/participants/olu`, {
    signedinUser: { user: 'users/olu-google-id', displayName: 'Olu Owner' },
  })
  const at = seconds =>
    new Date(Date.parse('2026-10-01T10:00:00Z') + seconds * 1000).toISOString()
  google.entries.set(name, [
    {
      participant: `${recordName}/participants/olu`,
      text: 'We ran ten interviews.',
      startTime: at(65),
    },
    {
      participant: `${recordName}/participants/mo`,
      text: 'How did it go?',
      startTime: at(0),
    },
  ])
}

const callsTo = method => google.calls.filter(call => call.method === method)

before(startDatabase)
after(stopDatabase)
beforeEach(async () => {
  data = await seed()
  await connectCalendar(data.users.mentor)
})

describe('collecting transcripts', () => {
  it('saves a generated transcript with speaker names, in order', async () => {
    const checkIn = await pastCheckIn(2)
    addRecord(checkIn, 'conferenceRecords/r1')
    addTranscript('conferenceRecords/r1')

    assert.equal(await pollTranscripts(), 1)
    const saved = await CheckIn.findById(checkIn._id)
    assert.equal(saved.status, 'HELD')
    assert.equal(saved.transcript.status, 'READY')
    assert.equal(saved.transcript.conferenceRecord, 'conferenceRecords/r1')
    assert.deepEqual(
      saved.transcript.entries.map(e => [e.speaker, e.text, e.googleId]),
      [
        // Signed in without an account ID: just the name.
        ['Mo Mentor', 'How did it go?', undefined],
        // The Google account ID that sign-in stores as User.googleId.
        ['Olu Owner', 'We ran ten interviews.', 'olu-google-id'],
      ]
    )
    assert.equal(
      saved.transcript.text,
      '[00:00] Mo Mentor: How did it go?\n[01:05] Olu Owner: We ran ten interviews.'
    )
    assert.equal(saved.transcript.truncated, false)
    assert.equal(saved.transcript.nextPollAt, null)

    // Settled: the next poll leaves it alone.
    google.calls.length = 0
    assert.equal(await pollTranscripts(), 0)
    assert.equal(callsTo('conferenceRecords').length, 0)
  })

  it('waits while Meet is still making the transcript', async () => {
    const checkIn = await pastCheckIn(1)
    addRecord(checkIn, 'conferenceRecords/r1')
    addTranscript('conferenceRecords/r1', 'ENDED')

    const now = new Date()
    await pollTranscripts(now)
    let saved = await CheckIn.findById(checkIn._id)
    assert.equal(saved.status, 'HELD')
    assert.equal(saved.transcript.status, 'PENDING')
    assert.equal(saved.transcript.attempts, 1)
    assert.equal(
      saved.transcript.nextPollAt.getTime(),
      now.getTime() + 15 * MINUTE_MS
    )

    // Not due again yet.
    assert.equal(await pollTranscripts(now), 0)

    addTranscript('conferenceRecords/r1')
    await pollTranscripts(new Date(now.getTime() + 16 * MINUTE_MS))
    saved = await CheckIn.findById(checkIn._id)
    assert.equal(saved.transcript.status, 'READY')
  })

  it('records a meeting held without transcription', async () => {
    const checkIn = await pastCheckIn(2)
    addRecord(checkIn, 'conferenceRecords/r1')

    await pollTranscripts()
    const saved = await CheckIn.findById(checkIn._id)
    assert.equal(saved.status, 'HELD')
    assert.equal(saved.transcript.status, 'UNAVAILABLE')
  })

  it('keeps waiting for a conference that is still going', async () => {
    const checkIn = await pastCheckIn(1)
    addRecord(checkIn, 'conferenceRecords/r1', { ended: false })

    await pollTranscripts()
    const saved = await CheckIn.findById(checkIn._id)
    assert.equal(saved.status, 'HELD')
    assert.equal(saved.transcript.status, 'PENDING')
  })

  it('marks a meeting nobody joined as not held, after two days', async () => {
    const checkIn = await pastCheckIn(1)
    await pollTranscripts()
    let saved = await CheckIn.findById(checkIn._id)
    assert.equal(saved.status, 'SCHEDULED')
    assert.equal(saved.transcript.status, 'PENDING')

    const later = new Date(Date.now() + GIVE_UP_MS)
    await pollTranscripts(later)
    saved = await CheckIn.findById(checkIn._id)
    assert.equal(saved.status, 'NOT_HELD')
    assert.equal(saved.transcript.status, 'UNAVAILABLE')
  })

  it('finds a meeting held hours after its time', async () => {
    const checkIn = await pastCheckIn(30)
    addRecord(checkIn, 'conferenceRecords/late', { minutesAfter: 23 * 60 })
    addTranscript('conferenceRecords/late')

    await pollTranscripts()
    const saved = await CheckIn.findById(checkIn._id)
    assert.equal(saved.status, 'HELD')
    assert.equal(saved.transcript.status, 'READY')
  })

  it("finds each occurrence's own conference in a series", async () => {
    const earlier = await pastCheckIn(14 * 24 + 2, { transcript: {} })
    const latest = await pastCheckIn(2)
    addRecord(earlier, 'conferenceRecords/old')
    addTranscript('conferenceRecords/old')
    addRecord(latest, 'conferenceRecords/new')
    addTranscript('conferenceRecords/new', 'STARTED')

    await pollTranscripts()
    const saved = await CheckIn.findById(latest._id)
    assert.equal(saved.transcript.conferenceRecord, 'conferenceRecords/new')
    assert.equal(saved.transcript.status, 'PENDING')
  })

  it('tries again later when Google fails', async () => {
    const checkIn = await pastCheckIn(2)
    google.failures.set('conferenceRecords', new GoogleError('Backend Error'))

    await pollTranscripts()
    const saved = await CheckIn.findById(checkIn._id)
    assert.equal(saved.transcript.status, 'PENDING')
    assert.equal(saved.transcript.attempts, 1)
    assert.ok(saved.transcript.nextPollAt > new Date())
  })

  it('leaves check-ins that are cancelled or not over yet', async () => {
    await pastCheckIn(2, { status: 'CANCELLED' })
    await pastCheckIn(0.25)
    assert.equal(await pollTranscripts(), 0)
    assert.equal(callsTo('conferenceRecords').length, 0)
  })

  it('fetches each check-in once when two polls overlap', async () => {
    const checkIn = await pastCheckIn(2)
    addRecord(checkIn, 'conferenceRecords/r1')
    addTranscript('conferenceRecords/r1')

    const now = new Date()
    const counts = await Promise.all([
      pollTranscripts(now),
      pollTranscripts(now),
    ])
    assert.equal(counts[0] + counts[1], 1)
    assert.equal(callsTo('conferenceRecords').length, 1)
  })
})

describe('reading transcripts and notes', () => {
  let checkIn
  beforeEach(async () => {
    checkIn = await pastCheckIn(2)
    addRecord(checkIn, 'conferenceRecords/r1')
    addTranscript('conferenceRecords/r1')
    await pollTranscripts()
  })

  it('the startup and its staff read the transcript; lists leave it out', async () => {
    const url = `/api/checkins/${checkIn._id}`
    for (const user of [
      data.users.owner,
      data.users.mentor,
      data.users.board,
    ]) {
      const res = await as(user).get(url)
      assert.equal(res.status, 200, user.email)
      assert.equal(res.body.checkIn.transcript.entries.length, 2)
    }
    for (const user of [data.users.outsider, data.users.otherMentor]) {
      const res = await as(user).get(url)
      assert.equal(res.status, 403, user.email)
    }

    const list = await as(data.users.owner).get('/api/checkins')
    const [listed] = list.body.checkIns
    assert.equal(listed.transcript.status, 'READY')
    assert.equal(listed.transcript.entries, undefined)
    assert.equal(listed.transcript.text, undefined)
  })

  it('only the mentor writes notes', async () => {
    const url = `/api/checkins/${checkIn._id}/notes`
    const saved = await as(data.users.mentor).put(url, {
      notes: 'Agreed to ship the pilot.',
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.notes, 'Agreed to ship the pilot.')

    for (const user of [data.users.owner, data.users.board]) {
      const res = await as(user).put(url, { notes: 'Changed' })
      assert.equal(res.status, 403, user.email)
    }
    const tooLong = await as(data.users.mentor).put(url, {
      notes: 'x'.repeat(20001),
    })
    assert.equal(tooLong.status, 400)

    const read = await as(data.users.owner).get(`/api/checkins/${checkIn._id}`)
    assert.equal(read.body.checkIn.notes, 'Agreed to ship the pilot.')
  })
})

describe('checking for a transcript now', () => {
  it('saves a transcript that has arrived', async () => {
    const checkIn = await pastCheckIn(2, {
      transcript: { status: 'UNAVAILABLE' },
      status: 'HELD',
    })
    addRecord(checkIn, 'conferenceRecords/r1')
    addTranscript('conferenceRecords/r1')

    const res = await as(data.users.mentor).post(
      `/api/checkins/${checkIn._id}/transcript/refresh`
    )
    assert.equal(res.status, 200)
    assert.equal(res.body.settled, true)
    assert.equal(res.body.checkIn.transcript.status, 'READY')
  })

  it("changes nothing when there's nothing new", async () => {
    const checkIn = await pastCheckIn(2)
    const res = await as(data.users.mentor).post(
      `/api/checkins/${checkIn._id}/transcript/refresh`
    )
    assert.equal(res.status, 200)
    assert.equal(res.body.settled, false)
    const saved = await CheckIn.findById(checkIn._id)
    assert.equal(saved.transcript.status, 'PENDING')
    assert.equal(saved.transcript.attempts, 0)
    assert.equal(
      saved.transcript.nextPollAt.getTime(),
      checkIn.transcript.nextPollAt.getTime()
    )
  })

  it('is for the mentor, after the meeting', async () => {
    const upcoming = await pastCheckIn(-2)
    const early = await as(data.users.mentor).post(
      `/api/checkins/${upcoming._id}/transcript/refresh`
    )
    assert.equal(early.status, 409)

    const past = await pastCheckIn(2)
    const student = await as(data.users.owner).post(
      `/api/checkins/${past._id}/transcript/refresh`
    )
    assert.equal(student.status, 403)
  })
})
