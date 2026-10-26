import CheckIn from '../models/checkIn.js'
import { googleFor } from './checkInHelper.js'

// Collects each check-in's Google Meet transcript after the meeting, through
// the mentor's Google connection, and records whether the meeting was held.
// Meet makes a transcript only when someone turns transcription on (or the
// Workspace does it by default), so many check-ins won't have one.
//
// utils/jobs.js runs it; tests call pollTranscripts directly.

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

// Look again after 15 minutes, 30, an hour, two, then every four.
const BACKOFF_MS = [15, 30, 60, 120].map(minutes => minutes * MINUTE_MS)
const LATER_MS = 4 * HOUR_MS
// Meet usually has the transcript within the hour. After two days without
// one it isn't coming.
export const GIVE_UP_MS = 48 * HOUR_MS
// A conference belongs to the check-in if it starts within a day of the
// check-in's time, so a meeting held late or early still counts. A series'
// occurrences share a Meet code but are two weeks apart.
const MATCH_WINDOW_MS = 24 * HOUR_MS
// While one poll works on a check-in, another leaves it alone.
const LEASE_MS = 10 * MINUTE_MS
const BATCH = 25
// About 1 MB of text keeps a check-in well inside MongoDB's 16 MB limit.
const MAX_TEXT = 1_000_000

const endOf = checkIn =>
  checkIn.scheduledAt.getTime() + checkIn.durationMinutes * MINUTE_MS

const backoff = attempts => BACKOFF_MS[attempts] ?? LATER_MS

// The conferences held at the check-in's time, earliest first. People who
// leave and rejoin an empty meeting start a second conference.
export const matchRecords = (records, checkIn) => {
  const from = checkIn.scheduledAt.getTime() - MATCH_WINDOW_MS
  const to = endOf(checkIn) + MATCH_WINDOW_MS
  return records
    .filter(record => {
      const start = new Date(record.startTime).getTime()
      return start >= from && start <= to
    })
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
}

const displayName = participant =>
  participant?.signedinUser?.displayName ??
  participant?.anonymousUser?.displayName ??
  participant?.phoneUser?.displayName ??
  'Unknown speaker'

// A signed-in speaker's Google account ID ("users/1098..." gives "1098..."),
// the same ID Google sign-in gives us as User.googleId. Guests and phone
// callers have none.
const googleIdOf = participant =>
  participant?.signedinUser?.user?.match(/^users\/(.+)$/u)?.[1]

// Who each participant is: their name and, when signed in, their account.
const speakersOf = async (google, participantNames) => {
  const speakers = new Map()
  for (const name of new Set(participantNames)) {
    try {
      const participant = await google('participant', name)
      speakers.set(name, {
        speaker: displayName(participant),
        googleId: googleIdOf(participant),
      })
    } catch {
      speakers.set(name, { speaker: 'Unknown speaker' })
    }
  }
  return speakers
}

// "[12:05]": minutes and seconds into the meeting.
const offset = (time, start) => {
  const seconds = Math.max(0, Math.round((new Date(time) - start) / 1000))
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `[${mm}:${ss}]`
}

// The transcripts' entries in order, with speaker names, cut to MAX_TEXT.
export const collectTranscript = async (google, transcripts) => {
  const raw = (
    await Promise.all(
      transcripts.map(transcript =>
        google('transcriptEntries', transcript.name)
      )
    )
  )
    .flat()
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
  const speakers = await speakersOf(
    google,
    raw.map(entry => entry.participant)
  )
  const start = raw.length ? new Date(raw[0].startTime) : null

  const entries = []
  const lines = []
  let length = 0
  for (const entry of raw) {
    const { speaker, googleId } = speakers.get(entry.participant)
    const line = `${offset(entry.startTime, start)} ${speaker}: ${entry.text}`
    if (length + line.length > MAX_TEXT) {
      break
    }
    length += line.length + 1
    lines.push(line)
    entries.push({
      speaker,
      googleId,
      text: entry.text,
      startTime: entry.startTime,
    })
  }
  return {
    entries,
    text: lines.join('\n'),
    truncated: entries.length < raw.length,
  }
}

const unavailable = { 'transcript.status': 'UNAVAILABLE' }

// What Meet says about the check-in now: { fields, done }. Not done means
// look again later. `giveUp` settles whatever is still open.
const inspect = async (google, checkIn, giveUp) => {
  const records = matchRecords(
    await google('conferenceRecords', checkIn.meetingCode),
    checkIn
  )
  if (!records.length) {
    return giveUp
      ? { fields: { status: 'NOT_HELD', ...unavailable }, done: true }
      : { fields: {}, done: false }
  }

  const held = {
    status: 'HELD',
    'transcript.conferenceRecord': records[0].name,
  }
  const transcripts = (
    await Promise.all(records.map(record => google('transcripts', record.name)))
  ).flat()
  const ready = transcripts.filter(t => t.state === 'FILE_GENERATED')
  const stillMaking =
    transcripts.length > ready.length || records.some(r => !r.endTime)

  if (ready.length && (!stillMaking || giveUp)) {
    const transcript = await collectTranscript(google, ready)
    return {
      fields: {
        ...held,
        'transcript.status': 'READY',
        'transcript.entries': transcript.entries,
        'transcript.text': transcript.text,
        'transcript.truncated': transcript.truncated,
      },
      done: true,
    }
  }
  // The meeting is over and nobody turned transcription on.
  if (!stillMaking || giveUp) {
    return { fields: { ...held, ...unavailable }, done: true }
  }
  return { fields: held, done: false }
}

// What Meet says, or (when Google can't be reached) nothing new, unless it
// is time to give up.
const checkMeet = async (checkIn, giveUp) => {
  try {
    // Programme meetings are on the admin's calendar, the rest on the mentor's.
    const google = await googleFor(checkIn.host ?? checkIn.mentor)
    return await inspect(google, checkIn, giveUp)
  } catch (error) {
    console.warn(
      `Transcript for check-in ${checkIn._id} not fetched:`,
      error.message
    )
    return giveUp
      ? { fields: unavailable, done: true }
      : { fields: {}, done: false }
  }
}

// A group session is one meeting with a CheckIn per startup: what is found
// for one is saved on all of them.
const sharedWith = checkIn =>
  checkIn.group
    ? { googleEventId: checkIn.googleEventId, status: { $ne: 'CANCELLED' } }
    : { _id: checkIn._id }

// When to look again: never once settled, else after the next backoff.
const nextPoll = (attempts, done, now) => ({
  'transcript.attempts': attempts,
  'transcript.nextPollAt': done
    ? null
    : new Date(now.getTime() + backoff(attempts - 1)),
})

// Looks for one check-in's transcript and saves what it finds. A manual
// check (the mentor's "Check Now") only saves a definite answer, and
// doesn't move the poller's schedule. Returns whether it is settled.
export const processCheckIn = async (
  checkIn,
  { now = new Date(), manual = false } = {}
) => {
  const giveUp = !manual && now.getTime() >= endOf(checkIn) + GIVE_UP_MS
  const { fields, done } = await checkMeet(checkIn, giveUp)
  if (manual && !done) {
    return false
  }
  const schedule = manual
    ? {}
    : nextPoll((checkIn.transcript?.attempts ?? 0) + 1, done, now)
  await CheckIn.updateMany(sharedWith(checkIn), {
    $set: { ...fields, ...schedule, 'transcript.fetchedAt': now },
  })
  return done
}

// Works through the check-ins whose transcript is due. Each is claimed
// first, so two servers never fetch the same one.
export const pollTranscripts = async (now = new Date()) => {
  const due = await CheckIn.find({
    status: { $in: ['SCHEDULED', 'HELD'] },
    meetingCode: { $ne: null },
    'transcript.status': 'PENDING',
    'transcript.nextPollAt': { $lte: now },
  })
    .select('transcript.nextPollAt')
    .sort({ 'transcript.nextPollAt': 1 })
    .limit(BATCH)

  let processed = 0
  for (const { _id, transcript } of due) {
    const claimed = await CheckIn.findOneAndUpdate(
      { _id, 'transcript.nextPollAt': transcript.nextPollAt },
      { $set: { 'transcript.nextPollAt': new Date(now.getTime() + LEASE_MS) } },
      { returnDocument: 'after' }
    )
    if (claimed) {
      // The rest of a group wait while this one fetches for them all.
      if (claimed.group) {
        await CheckIn.updateMany(sharedWith(claimed), {
          $set: { 'transcript.nextPollAt': claimed.transcript.nextPollAt },
        })
      }
      await processCheckIn(claimed, { now })
      processed += 1
    }
  }
  return processed
}
