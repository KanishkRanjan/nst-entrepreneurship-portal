import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { ROLES } from '@nst/shared/permissions.js'
import User from '../models/user.js'
import Campus from '../models/campus.js'
import Batch from '../models/batch.js'
import {
  validateAll,
  validateBatchAndCampus,
  normalizeName,
  validateName,
  validatePassword,
} from '../utils/validator.js'
import { getUserPortfolio } from '../utils/userPortfolio.js'
import {
  otpCooldownMessage,
  sendSignupCode,
  redeemSignupCode,
  clearSignupCode,
  sendPasswordResetCode,
  checkPasswordResetCode,
  redeemPasswordResetCode,
} from '../utils/otpHelper.js'
import {
  cookieOptions,
  signToken,
  signGoogleSignupToken,
  verifyGoogleSignupToken,
} from '../utils/token.js'
import { listEmailDomains } from '../utils/emailDomains.js'
import {
  findRoleForEmail,
  getGoogleAuthUrl,
  normalizeEmail,
  startSession,
  verifyGoogleAuthCode,
  DEACTIVATED_MESSAGE,
} from '../utils/authHelper.js'

// Responses must not reveal whether an email has an account, so endpoints
// that take only an email answer the same way either way.
const SIGNUP_CODE_MESSAGE =
  'If this email is not registered yet, a 6-digit verification code has been sent to it. Already have an account? Sign in or reset your password instead.'
const RESET_CODE_MESSAGE =
  'If an account exists for this email, a 6-digit verification code has been sent to it. You can request a new code once a minute.'
const INVALID_VERIFICATION = 'Invalid or expired verification request'

// Compared against when no user matches, so sign-in takes as long as a real
// password check and its timing doesn't reveal which emails exist.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('no-such-user', 10)

// The sign-up form sends "" for a choice left blank. Staff have no campus or
// batch, so whatever their form sends is dropped.
const noneIfBlank = value => value || undefined
const studentPlace = (position, { batch, campus }) =>
  position === ROLES.STUDENT
    ? { batch: noneIfBlank(batch), campus: noneIfBlank(campus) }
    : { batch: undefined, campus: undefined }

export const signUp = async (req, res) => {
  try {
    const { email, password, batch, campus } = req.body
    const username = normalizeName(req.body.username)

    const { position, role } = await findRoleForEmail(email)
    if (!role) {
      return res.status(500).json({
        error: `${position} role is not configured`,
      })
    }

    const error = {
      ...(await validateAll({ username, email, password, position })),
      // Students need both, as with Google sign-up: a proposal takes the
      // student's campus. Staff have neither, so theirs aren't checked.
      ...(position === ROLES.STUDENT &&
        (await validateBatchAndCampus({ batch, campus }, { required: true }))),
    }
    if (Object.values(error).some(value => value.trim() !== '')) {
      return res.status(400).json({ error })
    }

    const normalizedEmail = normalizeEmail(email)
    let user = await User.findOne({ email: normalizedEmail })

    const codeResponse = {
      requireOtp: true,
      email: normalizedEmail,
      message: SIGNUP_CODE_MESSAGE,
    }

    if (user && user.isEmailVerified) {
      return res.status(200).json(codeResponse)
    }

    if (user) {
      // The account exists but nobody has proved they own this email, so it
      // may be someone else's (e.g. created by an admin). Leave it as it is
      // and keep these details until the emailed code is used.
      user.pendingSignup = {
        username,
        passwordHash: await bcrypt.hash(password, 10),
        ...studentPlace(position, { batch, campus }),
      }
    } else {
      user = new User({
        username,
        email: normalizedEmail,
        password,
        role: role._id,
        ...studentPlace(position, { batch, campus }),
        isEmailVerified: false,
      })
    }

    await sendSignupCode(user)

    return res.status(200).json(codeResponse)
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        error: {
          email: 'Email already in use',
        },
      })
    }

    console.error('SignUp error:', err)
    return res.status(500).json({
      error: 'Server error',
    })
  }
}

export const signIn = async (req, res) => {
  try {
    const { email, password } = req.body

    const user = await User.findOne({ email: normalizeEmail(email) }).populate(
      'role'
    )
    if (!user) {
      await bcrypt.compare(String(password), DUMMY_PASSWORD_HASH)
    }
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        error: 'Invalid email or password',
      })
    }

    if (!user.isEmailVerified && !user.googleId) {
      const { retryAfter } = await sendSignupCode(user)

      return res.status(403).json({
        error: retryAfter
          ? `Your email address is not verified yet. ${otpCooldownMessage(retryAfter)}`
          : 'Your email address is not verified yet. A 6-digit verification code has been sent to your email.',
        requireOtp: true,
        email: user.email,
      })
    }

    return await startSession(res, user)
  } catch (err) {
    console.error('SignIn error:', err)
    return res.status(500).json({
      error: 'Server error',
    })
  }
}

export const signOut = async (_, res) => {
  return res.clearCookie('token', cookieOptions).json({ success: true })
}

export const portfolio = async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const data = await getUserPortfolio(req.user.id)
  if (!data) {
    return res.status(404).json({ error: 'User not found' })
  }

  return res.json(data)
}

// Ties Google's callback to the browser that started sign-in. Without it, an
// attacker could send someone their own callback link and sign them in to
// the attacker's account.
const OAUTH_STATE_COOKIE = 'google_oauth_state'
const oauthStateCookieOptions = { ...cookieOptions, maxAge: 10 * 60 * 1000 }

// Set while a signed-in user connects their Google account, so the
// callback links it to them instead of signing in.
const GOOGLE_LINK_COOKIE = 'google_link'

export const googleAuth = (req, res) => {
  const state = crypto.randomBytes(32).toString('hex')
  return res
    .clearCookie(GOOGLE_LINK_COOKIE, cookieOptions)
    .cookie(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions)
    .redirect(getGoogleAuthUrl(state))
}

// Connects the signed-in user's Google account, so the KPI bot knows them
// in Meet transcripts by account rather than by name.
export const googleLink = (req, res) => {
  const state = crypto.randomBytes(32).toString('hex')
  return res
    .cookie(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions)
    .cookie(GOOGLE_LINK_COOKIE, '1', oauthStateCookieOptions)
    .redirect(getGoogleAuthUrl(state))
}

const hasValidOAuthState = req => {
  const { state } = req.query
  const expected = req.cookies[OAUTH_STATE_COOKIE]
  return typeof state === 'string' && Boolean(expected) && state === expected
}

// Ties a Google sign-in to the account with that email.
const linkGoogleAccount = async (user, googleId) => {
  if (!user.isEmailVerified) {
    // Nobody proved ownership of this email before Google did, so the
    // password or a pending sign-up may be someone else's. Drop them.
    user.password = undefined
    user.pendingSignup = undefined
    clearSignupCode(user)
  }
  if (!user.googleId || !user.isEmailVerified) {
    user.googleId = googleId
    user.isEmailVerified = true
    await user.save()
  }
}

// Back to onboarding with ?google=<outcome>; once linked, onboarding moves
// on to the next step or into the portal.
const linkOutcome = (res, outcome) =>
  res.redirect(`${process.env.FRONTEND_URL || ''}/onboarding?google=${outcome}`)

// Why this Google account can't be linked to the signed-in user, or null.
// Only their own school account (the same email) is taken: any other would
// sign in as, or sign up, someone else.
const linkProblem = async (user, { googleId, email, error }) => {
  // A personal or unverified account isn't their school one.
  if (error || !user || email !== user.email) {
    return 'wrong-account'
  }
  if (user.googleId && user.googleId !== googleId) {
    return 'wrong-account'
  }
  if (await User.exists({ googleId, _id: { $ne: user._id } })) {
    return 'taken'
  }
  return null
}

// Links a Google account to the signed-in user.
const finishGoogleLink = async (req, res, verification) => {
  if (!req.user) {
    return linkOutcome(res, 'signed-out')
  }
  const user = await User.findById(req.user.id)
  const problem = await linkProblem(user, verification)
  if (problem) {
    return linkOutcome(res, problem)
  }
  user.googleId = verification.googleId
  user.isEmailVerified = true
  try {
    await user.save()
  } catch (saveError) {
    // Another account took this Google ID since the check above.
    if (saveError?.code === 11000) {
      return linkOutcome(res, 'taken')
    }
    throw saveError
  }
  return linkOutcome(res, 'linked')
}

export const googleAuthCallback = async (req, res) => {
  try {
    const { code } = req.query
    const validState = hasValidOAuthState(req)
    const linking = req.cookies[GOOGLE_LINK_COOKIE] === '1'
    res.clearCookie(OAUTH_STATE_COOKIE, oauthStateCookieOptions)
    res.clearCookie(GOOGLE_LINK_COOKIE, cookieOptions)
    if (!validState) {
      return res
        .status(400)
        .send(
          'Google sign-in expired or was not started here. Please try again.'
        )
    }

    if (!code) {
      return res.status(400).send('Google authorization code is missing.')
    }

    const verificationResult = await verifyGoogleAuthCode(code)
    if (linking) {
      return await finishGoogleLink(req, res, verificationResult)
    }
    if (verificationResult.error) {
      return res
        .status(verificationResult.status)
        .send(verificationResult.error)
    }

    const { googleId, email } = verificationResult

    const user = await User.findOne({
      $or: [{ googleId }, { email }],
    }).populate('role')

    if (user?.deletedAt) {
      return res.status(403).send(DEACTIVATED_MESSAGE)
    }

    if (user) {
      await linkGoogleAccount(user, googleId)

      return res
        .cookie('token', signToken(user), cookieOptions)
        .redirect(process.env.FRONTEND_URL)
    }

    const signupToken = signGoogleSignupToken({ googleId, email })

    return res.redirect(
      `${process.env.FRONTEND_URL}/complete-signup?token=${encodeURIComponent(
        signupToken
      )}`
    )
  } catch (error) {
    console.error('Authentication error:', error)
    return res.status(500).send('Authentication failed')
  }
}

export const getGoogleSignupOptions = async (req, res) => {
  try {
    const [campuses, batches, domains] = await Promise.all([
      Campus.find().sort({ name: 1 }),
      Batch.find().populate('campus', 'name').sort({ name: 1 }),
      listEmailDomains(),
    ])

    return res.status(200).json({
      campuses,
      batches,
      // The sign-up forms leave out campus and batch for these.
      staffDomains: domains
        .filter(entry => entry.staff)
        .map(entry => entry.domain),
    })
  } catch (error) {
    console.error('Get Google signup options error:', error)
    return res.status(500).json({
      error: 'Failed to load signup options',
    })
  }
}

const parseGoogleSignupToken = token => {
  if (!token) {
    return { error: 'Signup token is required' }
  }
  try {
    return { data: verifyGoogleSignupToken(token) }
  } catch {
    return { error: 'Signup token is invalid or expired' }
  }
}

export const completeGoogleSignup = async (req, res) => {
  try {
    const { token, batch, campus } = req.body
    const username = normalizeName(req.body.username)
    const parsed = parseGoogleSignupToken(token)
    if (parsed.error) {
      return res.status(401).json({ error: parsed.error })
    }

    const { googleId, email } = parsed.data
    const { position, role } = await findRoleForEmail(email)
    const isStudent = position === ROLES.STUDENT

    // Same name rules as email sign-up, and real batch/campus records for a
    // student. Staff have neither.
    const fieldErrors = [
      validateName(username),
      ...(isStudent
        ? Object.values(
            await validateBatchAndCampus({ batch, campus }, { required: true })
          )
        : []),
    ].filter(Boolean)
    if (fieldErrors.length) {
      return res.status(400).json({ error: fieldErrors[0] })
    }

    if (!role) {
      console.error(`${position} role does not exist in database`)
      return res.status(500).json({
        error: `${position} role is not configured`,
      })
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { googleId }],
    })
    if (existingUser) {
      return res.status(409).json({
        error: 'An account already exists with this Google account',
      })
    }

    const user = new User({
      username,
      email,
      googleId,
      ...studentPlace(position, { batch, campus }),
      role: role._id,
      isEmailVerified: true,
    })

    await user.save()
    user.role = role

    return await startSession(res, user, { status: 201 })
  } catch (error) {
    console.error('Complete Google signup error:', error)
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Email already in use',
      })
    }

    return res.status(500).json({
      error: 'Server error',
    })
  }
}

export const forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email)
    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    // Same answer for unknown emails and during the cooldown, when the code
    // sent moments ago is still valid.
    const user = await User.findOne({ email })
    if (user) {
      await sendPasswordResetCode(user)
    }

    return res.status(200).json({ message: RESET_CODE_MESSAGE })
  } catch (error) {
    console.error('Forgot password error:', error)
    const isDbTimeout =
      error.message?.includes('buffering timed out') ||
      error.message?.includes('selection timed out')
    return res.status(500).json({
      error: isDbTimeout
        ? 'Database connection timed out. Please try again in a moment.'
        : 'Failed to process forgot password request',
    })
  }
}

export const verifyOtp = async (req, res) => {
  try {
    const { otp } = req.body
    const email = normalizeEmail(req.body.email)

    if (!email || !otp) {
      return res
        .status(400)
        .json({ error: 'Email and verification code are required' })
    }

    const user = await User.findOne({ email })
    const validationError = await checkPasswordResetCode(user, otp)
    if (validationError) {
      return res.status(400).json({ error: validationError })
    }

    return res
      .status(200)
      .json({ message: 'Verification code verified successfully' })
  } catch (error) {
    console.error('Verify OTP error:', error)
    return res.status(500).json({ error: 'Failed to verify code' })
  }
}

export const resetPassword = async (req, res) => {
  try {
    const { otp, password } = req.body
    const email = normalizeEmail(req.body.email)

    if (!email || !otp || !password) {
      return res.status(400).json({
        error: 'Email, verification code, and new password are required',
      })
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      return res.status(400).json({ error: passwordError })
    }

    const user = await User.findOne({ email })
    const validationError = await redeemPasswordResetCode(user, otp)
    if (validationError) {
      return res.status(400).json({ error: validationError })
    }

    user.password = password
    // Whoever needed a reset may have had their session stolen too.
    user.sessionVersion += 1
    await user.save()

    return res
      .status(200)
      .json({ message: 'Password reset successfully! You can now log in.' })
  } catch (error) {
    console.error('Reset password error:', error)
    return res.status(500).json({ error: 'Failed to reset password' })
  }
}

// Whether the password matches the sign-up that sent the code: the pending
// one for an account that already existed, otherwise the account's own.
const signupPasswordMatches = (user, password) =>
  user.pendingSignup?.passwordHash
    ? bcrypt.compare(password, user.pendingSignup.passwordHash)
    : user.comparePassword(password)

// Once the code proves the email, the pending sign-up becomes the account.
const adoptPendingSignup = (user, password) => {
  const pending = user.pendingSignup
  if (!pending?.passwordHash) {
    return
  }
  user.username = pending.username
  user.password = password
  // The account's role stays: it may have been set by an admin, and an email
  // sign-up must not reset it.
  user.batch = pending.batch
  user.campus = pending.campus
  user.pendingSignup = undefined
}

export const verifySignupOtp = async (req, res) => {
  try {
    const { otp, password } = req.body
    const email = normalizeEmail(req.body.email)

    if (!email || !otp || !password) {
      return res.status(400).json({
        error: 'Email, password and verification code are required',
      })
    }

    // Never issue a session here without a valid code, or anyone could log in
    // as a verified user just by knowing their email. Unknown and verified
    // emails get the same error as a bad request.
    const user = await User.findOne({ email }).populate('role')
    if (!user || user.isEmailVerified) {
      return res.status(400).json({ error: INVALID_VERIFICATION })
    }

    const validationError = await redeemSignupCode(user, otp)
    if (validationError) {
      return res.status(400).json({ error: validationError })
    }

    // Checked after the code so this can't be used to guess passwords. A
    // newer sign-up for the same email means these details are stale.
    if (!(await signupPasswordMatches(user, password))) {
      return res.status(400).json({
        error: 'Your sign-up details have changed. Please sign up again.',
      })
    }

    adoptPendingSignup(user, password)
    user.isEmailVerified = true
    await user.save()
    await user.populate('role')

    return await startSession(res, user, {
      message: 'Email verified successfully!',
    })
  } catch (error) {
    console.error('Verify signup OTP error:', error)
    return res.status(500).json({ error: 'Failed to verify code' })
  }
}

export const resendSignupOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email)

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    const user = await User.findOne({ email })
    if (user && !user.isEmailVerified) {
      await sendSignupCode(user)
    }

    return res.status(200).json({ message: SIGNUP_CODE_MESSAGE })
  } catch (error) {
    console.error('Resend signup OTP error:', error)
    return res.status(500).json({ error: 'Failed to resend verification code' })
  }
}
