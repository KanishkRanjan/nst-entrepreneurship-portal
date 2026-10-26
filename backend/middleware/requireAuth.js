import { ROLES } from '@nst/shared/permissions.js'

// A student must connect their school Google account before using the
// portal, so the KPI bot knows them in Meet transcripts by account. The
// portal's onboarding asks for it; this makes the API ask too, so it can't be
// skipped by calling the API directly.
export const GOOGLE_NOT_LINKED = 'GOOGLE_NOT_LINKED'

const mustConnectGoogle = user =>
  user.role === ROLES.STUDENT && !user.googleLinked

// Signed in, nothing more. Only for what a student needs before connecting
// Google: connecting it.
export function requireSignedIn(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  return next()
}

export default function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (mustConnectGoogle(req.user)) {
    return res.status(403).json({
      error: 'Connect your school Google account to use the portal.',
      code: GOOGLE_NOT_LINKED,
    })
  }

  return next()
}
