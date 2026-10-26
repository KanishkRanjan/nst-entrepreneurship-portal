import User from '../models/user.js'
import { validateToken } from '../utils/token.js'

// The caller for a session token, or null if the token is no longer good.
// The user is loaded each time so that a password reset signs out old
// sessions and a role change applies at once, not when the 30-day token ends.
const findSessionUser = async token => {
  const { valid, payload } = validateToken(token)
  if (!valid || !payload.userId) {
    return null
  }

  const user = await User.findById(payload.userId)
    .select('email role sessionVersion deletedAt googleId')
    .populate('role', 'name')
    .lean()

  // Users and tokens from before session versions existed count as version 0.
  // A deactivated account's sessions end with it.
  if (
    !user ||
    user.deletedAt ||
    (user.sessionVersion ?? 0) !== (payload.sessionVersion ?? 0)
  ) {
    return null
  }

  return {
    id: String(user._id),
    email: user.email,
    role: user.role?.name,
    googleLinked: Boolean(user.googleId),
  }
}

// Runs on every request to identify the caller, it never rejects any request allowing public routes to be reachable. Use requireAuth to gate a route.
export default function attachUser(req, res, next) {
  return findSessionUser(req.cookies.token).then(user => {
    if (user) {
      req.user = user
    }
    return next()
  })
}
