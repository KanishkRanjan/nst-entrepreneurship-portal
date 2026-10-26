import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { OAuth2Client } from 'google-auth-library'
import request from 'supertest'

import app from '../app.js'
import User from '../models/user.js'
import { cookieFor, seed, startDatabase, stopDatabase } from './helpers.js'

// A founder who signed up with a password connects their Google account,
// so the KPI bot knows them in Meet transcripts by account.
let data

before(startDatabase)
after(stopDatabase)
// The owner signed up with a password and hasn't connected Google yet.
beforeEach(async () => {
  data = await seed()
  await User.updateOne(
    { _id: data.users.owner._id },
    { $unset: { googleId: 1 } }
  )
})

// Google answers the callback as this account.
const googleSays = (t, { sub, email }) => {
  t.mock.method(OAuth2Client.prototype, 'getToken', async () => ({
    tokens: { id_token: 'id-token' },
  }))
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({
    getPayload: () => ({ sub, email, email_verified: true }),
  }))
}

// Starts connecting as `user`, then comes back from Google.
const connect = async user => {
  const start = await request(app)
    .get('/api/auth/google/link')
    .set('Cookie', cookieFor(user))
  assert.equal(start.status, 302)
  const state = new URL(start.headers.location).searchParams.get('state')
  const cookies = start.headers['set-cookie'].map(c => c.split(';')[0])
  return request(app)
    .get('/api/auth/google/callback')
    .query({ state, code: 'code' })
    .set('Cookie', [cookieFor(user), ...cookies].join('; '))
}

const outcome = res =>
  new URL(res.headers.location, 'http://localhost').searchParams.get('google')

describe('connecting a Google account', () => {
  it('links the founder’s own school account', async t => {
    const owner = data.users.owner
    googleSays(t, { sub: 'olu-google-id', email: owner.email })
    const res = await connect(owner)
    assert.equal(outcome(res), 'linked')
    assert.equal((await User.findById(owner._id)).googleId, 'olu-google-id')

    const portfolio = await request(app)
      .get('/api/auth/portfolio')
      .set('Cookie', cookieFor(owner))
    assert.equal(portfolio.body.googleLinked, true)
  })

  it('refuses someone else’s account, and keeps the founder signed in as themselves', async t => {
    const owner = data.users.owner
    googleSays(t, { sub: 'oz-google-id', email: data.users.outsider.email })
    const res = await connect(owner)
    assert.equal(outcome(res), 'wrong-account')
    assert.equal((await User.findById(owner._id)).googleId, undefined)
    assert.equal(await User.exists({ googleId: 'oz-google-id' }), null)
    // No new session for the other account.
    assert.ok(
      !(res.headers['set-cookie'] || []).some(c => /^token=[^;]/.test(c))
    )
  })

  it('refuses a personal Gmail', async t => {
    googleSays(t, { sub: 'gmail-id', email: 'someone@gmail.com' })
    const res = await connect(data.users.owner)
    assert.equal(outcome(res), 'wrong-account')
  })

  it("blocks a student's API calls until they connect, but not staff's", async t => {
    const owner = data.users.owner
    const as = user => url =>
      request(app).get(url).set('Cookie', cookieFor(user))
    const blocked = await as(owner)('/api/kpis')
    assert.equal(blocked.status, 403)
    assert.equal(blocked.body.code, 'GOOGLE_NOT_LINKED')
    // What onboarding needs still works.
    assert.equal((await as(owner)('/api/auth/portfolio')).status, 200)
    // Staff never have to connect.
    await User.updateOne(
      { _id: data.users.mentor._id },
      { $unset: { googleId: 1 } }
    )
    assert.equal((await as(data.users.mentor)('/api/kpis/all')).status, 200)

    googleSays(t, { sub: 'olu-google-id', email: owner.email })
    await connect(owner)
    assert.equal((await as(owner)('/api/kpis')).status, 200)
  })

  it('needs the founder to be signed in', async () => {
    const res = await request(app).get('/api/auth/google/link')
    assert.equal(res.status, 401)
  })

  it('still signs in as usual without connecting', async t => {
    const owner = data.users.owner
    googleSays(t, { sub: 'olu-google-id', email: owner.email })
    const start = await request(app).get('/api/auth/google')
    const state = new URL(start.headers.location).searchParams.get('state')
    const cookies = start.headers['set-cookie'].map(c => c.split(';')[0])
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ state, code: 'code' })
      .set('Cookie', cookies.join('; '))
    assert.equal(outcome(res), null)
    assert.ok(res.headers['set-cookie'].some(c => /^token=[^;]/.test(c)))
  })
})
