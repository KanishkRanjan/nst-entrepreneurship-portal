import { OAuth2Client } from 'google-auth-library'
import 'dotenv/config'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID

const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI

const client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
)

const ALLOWED_GOOGLE_DOMAINS = new Set(['newtonschool.co', 'adypu.edu.in'])

export const determineUserRole = email => {
  if (typeof email !== 'string') {
    return 'student'
  }
  const emailSplit = email.split('@')
  if (
    emailSplit.length === 2 &&
    emailSplit[1].toLowerCase() === 'newtonschool.co'
  ) {
    return 'admin'
  }
  return 'student'
}

export const getGoogleAuthUrl = () => {
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email'],
    prompt: 'select_account',
  })
}

export const verifyGoogleAuthCode = async code => {
  const { tokens } = await client.getToken(code)
  client.setCredentials(tokens)

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  })

  const payload = ticket.getPayload()
  const { sub: googleId, email, email_verified: emailVerified } = payload

  if (!email) {
    return { error: 'Google did not provide an email address.', status: 403 }
  }

  if (!emailVerified) {
    return {
      error:
        'Your Google email address is not verified. Please verify it with Google first.',
      status: 403,
    }
  }

  const domain = email.split('@')[1]?.toLowerCase()
  if (!ALLOWED_GOOGLE_DOMAINS.has(domain)) {
    return {
      error: 'Only ADYPU and Newton School Google accounts are allowed.',
      status: 403,
    }
  }

  return { googleId, email: email.toLowerCase() }
}
