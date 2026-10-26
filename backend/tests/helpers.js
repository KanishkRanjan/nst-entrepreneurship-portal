import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

import Campus from '../models/campus.js'
import Founder from '../models/founder.js'
import GoogleCredential from '../models/googleCredential.js'
import Industry from '../models/industry.js'
import KPI from '../models/kpi.js'
import Role from '../models/role.js'
import User from '../models/user.js'
import Venture from '../models/venture.js'
import { setEmailProvider } from '../utils/emailProvider.js'
import {
  GoogleError,
  MEET_SETTINGS_SCOPE,
  REQUIRED_SCOPES,
  setGoogleWorkspace,
} from '../utils/googleWorkspace.js'
import { settleEmailJobs } from '../utils/kpiLockEmails.js'
import { migrateRbac } from '../utils/rbacMigration.js'
import { signToken } from '../utils/token.js'
import { encryptToken } from '../utils/tokenCrypto.js'

process.env.JWT_SECRET ||= 'test-secret'
// Never the developer's own key from .env.
process.env.GOOGLE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64')

// app.js loads the real .env, so tests must never reach Resend. Every email
// lands in `sentEmails` instead; a test can make the next sends fail by
// setting `emailFailures`.
export const sentEmails = []
export const emailFailures = new Set()
setEmailProvider({
  name: 'test',
  sendEmail: async ({ to, subject, html, text }) => {
    if (emailFailures.has(to)) {
      return { error: `Mailbox ${to} is unavailable` }
    }
    sentEmails.push({ to, subject, html, text })
    return { messageId: `test-${sentEmails.length}` }
  },
})

// Tests never reach Google either. `google` is a fake calendar: events by
// id, every call made, the accounts that can consent (`grants`, by code) and
// failures to throw (`failures`, by method name).
const DAY_MS = 24 * 60 * 60 * 1000
export const google = {
  events: new Map(),
  calls: [],
  grants: new Map(),
  failures: new Map(),
  revoked: [],
  // Meet: conference records, and each record's transcripts, each
  // transcript's entries and each participant, by resource name.
  records: [],
  transcripts: new Map(),
  entries: new Map(),
  participants: new Map(),
}

const fakeCall = (method, token, ...args) => {
  google.calls.push({ method, token, args })
  const failure = google.failures.get(method)
  if (failure) {
    throw failure
  }
}

const recurrenceCount = event =>
  Number(event.recurrence?.[0]?.match(/COUNT=(\d+)/)?.[1] ?? 1)

setGoogleWorkspace({
  name: 'test',
  authUrl: ({ state, loginHint }) =>
    `https://accounts.google.test/auth?state=${state}&login_hint=${loginHint}`,
  exchangeCode: async code => {
    fakeCall('exchangeCode', null, code)
    const grant = google.grants.get(code)
    if (!grant) {
      throw new GoogleError('invalid_grant', { status: 400 })
    }
    return grant
  },
  revoke: async token => {
    fakeCall('revoke', token)
    google.revoked.push(token)
  },
  createEvent: async (token, event) => {
    fakeCall('createEvent', token, event)
    const id = `event${google.events.size + 1}`
    const code = `abc-defg-${String(google.events.size + 1).padStart(3, '0')}`
    const created = {
      ...event,
      id,
      hangoutLink: `https://meet.google.com/${code}`,
      conferenceData: { conferenceId: code },
      // Whose calendar it's on: as at Google, only they can change it.
      owner: token,
    }
    google.events.set(id, created)
    return created
  },
  getEvent: async (token, id) => {
    fakeCall('getEvent', token, id)
    return google.events.get(id)
  },
  patchEvent: async (token, id, patch) => {
    fakeCall('patchEvent', token, id, patch)
    const event = google.events.get(id)
    if (event && event.owner !== token) {
      throw new GoogleError('Not Found', { status: 404 })
    }
    return { id, ...patch }
  },
  // Another calendar's event is "not found", which deleteEvent ignores.
  deleteEvent: async (token, id) => {
    fakeCall('deleteEvent', token, id)
    const event = google.events.get(id)
    if (event?.owner === token) {
      event.deleted = true
    }
  },
  conferenceRecords: async (token, meetingCode) => {
    fakeCall('conferenceRecords', token, meetingCode)
    return google.records.filter(r => r.meetingCode === meetingCode)
  },
  transcripts: async (token, recordName) => {
    fakeCall('transcripts', token, recordName)
    return google.transcripts.get(recordName) ?? []
  },
  transcriptEntries: async (token, transcriptName) => {
    fakeCall('transcriptEntries', token, transcriptName)
    return google.entries.get(transcriptName) ?? []
  },
  participant: async (token, name) => {
    fakeCall('participant', token, name)
    return google.participants.get(name)
  },
  autoTranscribe: async (token, meetingCode) => {
    fakeCall('autoTranscribe', token, meetingCode)
    return { meetingCode }
  },
  listInstances: async (token, id) => {
    fakeCall('listInstances', token, id)
    const event = google.events.get(id)
    const first = new Date(event.start.dateTime).getTime()
    return Array.from({ length: recurrenceCount(event) }, (_, i) => {
      const start = new Date(first + i * 14 * DAY_MS).toISOString()
      return {
        id: `${id}_${i}`,
        start: { dateTime: start },
        originalStartTime: { dateTime: start },
        hangoutLink: event.hangoutLink,
      }
    })
  },
})

// What a mentor has after connecting their Google Calendar. A connection
// made before the portal asked for Meet settings has only REQUIRED_SCOPES.
export const ALL_SCOPES = Object.freeze([
  ...REQUIRED_SCOPES,
  MEET_SETTINGS_SCOPE,
])
export const connectCalendar = (user, scopes = ALL_SCOPES) =>
  GoogleCredential.create({
    user: user._id,
    googleEmail: user.email,
    scopes,
    refreshToken: encryptToken(`refresh-${user.email}`),
  })

let mongod = null

export const startDatabase = async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
}

export const stopDatabase = async () => {
  await settleEmailJobs()
  await mongoose.disconnect()
  await mongod?.stop()
}

// The session cookie for a user, as the sign-in routes would set it.
export const cookieFor = user => `token=${signToken(user)}`

// One user per role (and a second mentor and admin), two startups and a few
// KPIs:
//   Alpha: mentored by `mentor`, founded by `owner`
//   Beta:  mentored by `otherMentor`, founded by `outsider`
export const seed = async () => {
  await settleEmailJobs()
  sentEmails.length = 0
  emailFailures.clear()
  google.events.clear()
  google.calls.length = 0
  google.grants.clear()
  google.failures.clear()
  google.revoked.length = 0
  google.records.length = 0
  google.transcripts.clear()
  google.entries.clear()
  google.participants.clear()
  await mongoose.connection.dropDatabase()
  await migrateRbac()
  const roles = Object.fromEntries(
    (await Role.find()).map(role => [role.name, role._id])
  )

  const campus = await Campus.create({ name: 'ADYPU', location: 'Pune' })
  const industry = await Industry.create({ name: 'EdTech' })

  // Students have connected Google, as the portal requires of them.
  const user = (username, email, role) =>
    User.create({
      username,
      email,
      password: 'password123',
      role: roles[role],
      isEmailVerified: true,
      ...(role === 'student' && { googleId: `google-${email}` }),
    })
  const [
    admin,
    admin2,
    board,
    mentor,
    otherMentor,
    owner,
    outsider,
    applicant,
  ] = await Promise.all([
    user('Ada Admin', 'ada@newtonschool.co', 'admin'),
    user('Ben Admin', 'ben@newtonschool.co', 'admin'),
    user('Bo Board', 'bo@newtonschool.co', 'academic_board'),
    user('Mo Mentor', 'mo@newtonschool.co', 'mentor'),
    user('Max Mentor', 'max@newtonschool.co', 'mentor'),
    user('Olu Owner', 'olu@adypu.edu.in', 'student'),
    user('Oz Outsider', 'oz@adypu.edu.in', 'student'),
    user('Ana Applicant', 'ana@adypu.edu.in', 'student'),
  ])

  const venture = (name, mentorId) =>
    Venture.create({
      name,
      campus: campus._id,
      industry: industry._id,
      mentors: [mentorId],
    })
  const alpha = await venture('Alpha', mentor._id)
  const beta = await venture('Beta', otherMentor._id)
  await Founder.create([
    { user: owner._id, venture: alpha._id },
    { user: outsider._id, venture: beta._id },
  ])

  const kpi = (ventureDoc, creator, fields) =>
    KPI.create({
      title: 'Interviews',
      description: 'Talk to customers',
      venture: ventureDoc._id,
      createdBy: creator._id,
      ...fields,
    })
  const kpis = {
    alphaGraded: await kpi(alpha, owner, { status: 'GRADED', score: 60 }),
    alphaDraft: await kpi(alpha, owner, { status: 'DRAFT' }),
    betaWaiting: await kpi(beta, outsider, { status: 'WAITING_FOR_APPROVAL' }),
  }

  return {
    users: {
      admin,
      admin2,
      board,
      mentor,
      otherMentor,
      owner,
      outsider,
      applicant,
    },
    ventures: { alpha, beta },
    kpis,
    campus,
    industry,
  }
}
