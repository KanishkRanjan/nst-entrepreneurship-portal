import mongoose from 'mongoose'
import { CYCLES } from '@nst/shared/biweeklyCycles.js'

// One bi-weekly check-in for a startup: an event with a Google Meet link,
// to which its founders are invited. Either a mentor's own check-in, on
// their calendar, or a meeting of a programme session, on the admin's.
const attendeeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    // When this person was (last) invited, so someone removed and added
    // back is told again.
    invitedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
)

const transcriptEntrySchema = new mongoose.Schema(
  {
    speaker: String,
    // The speaker's Google account ID when they were signed in to Meet; the
    // KPI bot matches it to User.googleId.
    googleId: String,
    text: String,
    startTime: Date,
  },
  { _id: false }
)

// The Google Meet transcript, collected after the meeting by
// utils/transcriptPoller.js. PENDING until Meet has made it (or it is clear
// it never will); READY with the transcript, or UNAVAILABLE.
const transcriptSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['PENDING', 'READY', 'UNAVAILABLE'],
      default: 'PENDING',
    },
    entries: [transcriptEntrySchema],
    // The entries as plain text, "[10:02] Mo Mentor: ..." per line.
    text: String,
    // A very long transcript is cut to fit; the full one stays in Google Docs.
    truncated: Boolean,
    conferenceRecord: String,
    fetchedAt: Date,
    // When the poller next looks, and how many times it has.
    nextPollAt: Date,
    attempts: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
)

// The KPI bot's pass over a READY transcript (utils/kpiBot.js): DONE with
// the KPIs it added and the goals it could not give a founder, SKIPPED when
// the meeting's KPIs already existed, FAILED to be retried.
const kpiExtractionSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['PENDING', 'DONE', 'SKIPPED', 'FAILED'],
      default: 'PENDING',
    },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: '' },
    created: { type: Number, default: 0 },
    skipped: [
      {
        _id: false,
        speaker: String,
        title: String,
        reason: String,
      },
    ],
    // The meeting's goals as Gemini gave them, kept so a retry and the other
    // check-ins of a group session reuse them. Unset until Gemini answers.
    candidates: {
      type: [mongoose.Schema.Types.Mixed],
      default: undefined,
    },
    // Set once saving KPIs has begun, so a retry finishes the job instead of
    // mistaking its own KPIs for an earlier import.
    started: Boolean,
    // While one server works on it, others leave it alone.
    leaseUntil: Date,
    processedAt: Date,
  },
  { _id: false }
)

const checkInSchema = new mongoose.Schema(
  {
    venture: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Venture',
      required: true,
    },
    mentor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Set for a programme session's meeting (see models/programmeSession).
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProgrammeSession',
      default: null,
      index: true,
    },
    // A programme meeting's version: one up each time its time, length or
    // staff change, so its emails go out again even when a change puts it
    // back the way it once was.
    revision: {
      type: Number,
      default: 0,
    },
    // Whose Google Calendar holds the event: the admin for programme
    // sessions, otherwise the mentor.
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // A group session: one event shared by every invited startup, each with
    // its own CheckIn.
    group: {
      type: Boolean,
      default: false,
    },
    // Everyone running the meeting. `mentor` is the first of them.
    staff: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Set when this is one occurrence of a recurring check-in.
    series: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckInSeries',
      default: null,
      index: true,
    },
    // The cycle the check-in falls in, from the startup's creation date.
    cycle_number: {
      type: Number,
      min: 1,
      max: CYCLES,
      default: null,
    },
    scheduledAt: {
      type: Date,
      required: true,
    },
    // Where the series first put this occurrence. Google identifies an
    // occurrence by it, and ending a series cuts the recurrence there.
    originalStartAt: {
      type: Date,
    },
    durationMinutes: {
      type: Number,
      required: true,
    },
    timeZone: {
      type: String,
      required: true,
    },
    // The event, or the occurrence of the recurring event, on the mentor's
    // calendar.
    googleEventId: {
      type: String,
      required: true,
    },
    meetUrl: {
      type: String,
    },
    // The Meet code (abc-defg-hij). Every occurrence of a series shares it.
    meetingCode: {
      type: String,
    },
    // The startup's active founders when the event was last written.
    attendees: [attendeeSchema],
    status: {
      type: String,
      enum: ['SCHEDULED', 'CANCELLED', 'HELD', 'NOT_HELD'],
      default: 'SCHEDULED',
    },
    cancelledAt: {
      type: Date,
    },
    transcript: {
      type: transcriptSchema,
      default: () => ({}),
    },
    kpiExtraction: {
      type: kpiExtractionSchema,
      default: () => ({}),
    },
    // The mentor's notes, and the record when Meet made no transcript.
    notes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
    // The KPI bot's working state (Gemini's raw answer, its lease) and the
    // speakers' Google account IDs are not for the API.
    toJSON: {
      transform: (doc, ret) => {
        delete ret.kpiExtraction
        for (const entry of ret.transcript?.entries || []) {
          delete entry.googleId
        }
        return ret
      },
    },
  }
)

checkInSchema.index({ venture: 1, scheduledAt: 1 })
// A founder's check-ins, for their profile.
checkInSchema.index({ 'attendees.user': 1, scheduledAt: 1 })
// The programme meetings a staff member runs.
checkInSchema.index({ staff: 1, scheduledAt: 1 })
// The check-ins whose transcript is due to be looked for.
checkInSchema.index({ 'transcript.status': 1, 'transcript.nextPollAt': 1 })
// The ready transcripts the KPI bot has still to go through.
checkInSchema.index({
  'transcript.status': 1,
  'kpiExtraction.status': 1,
  scheduledAt: 1,
})

export const modelName = 'CheckIn'

const CheckIn = mongoose.model(modelName, checkInSchema)

export default CheckIn
