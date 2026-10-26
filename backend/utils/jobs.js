import { scheduleDueSessions } from './programmeScheduler.js'
import { pollTranscripts } from './transcriptPoller.js'
import { extractCheckInKpis } from './kpiBot.js'

// The server's background work, every ten minutes: schedule programme
// sessions that are coming up, collect Meet transcripts of meetings that
// have ended, and turn those transcripts into founders' KPIs. Started by
// server.js, never by tests.

const MINUTE_MS = 60 * 1000
const EVERY_MS = 10 * MINUTE_MS

const JOBS = [
  ['Programme scheduling', scheduleDueSessions],
  ['Transcript poll', pollTranscripts],
  ['KPI extraction', extractCheckInKpis],
]

let timer = null
let inFlight = null

export const startBackgroundJobs = () => {
  if (timer) {
    return
  }
  // One run at a time: a slow one makes the next tick a no-op.
  const run = async () => {
    for (const [name, job] of JOBS) {
      try {
        await job()
      } catch (error) {
        console.error(`${name} failed:`, error)
      }
    }
  }
  const tick = () => {
    inFlight ??= run().finally(() => {
      inFlight = null
    })
  }
  timer = setInterval(tick, EVERY_MS)
  timer.unref()
  setTimeout(tick, MINUTE_MS).unref()
}
