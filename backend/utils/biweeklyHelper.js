import mongoose from 'mongoose'
import User from '../models/user.js'
import Venture from '../models/venture.js'
import Founder from '../models/founder.js'
import BiWeeklySubmission from '../models/biWeeklySubmission.js'
import { findVentureForUser } from './founderHelper.js'

export const validateCycleNumber = n => {
  const num = Number(n)
  return num >= 1 && num <= 13 ? num : null
}

export const findVenture = async (ventureId, founder, user) => {
  if (ventureId && mongoose.isValidObjectId(ventureId)) {
    return Venture.findById(ventureId).populate('campus industry').exec()
  }
  if (founder) {
    return findVentureForUser(founder._id)
  }
  if (user?.id && user?.role !== 'admin') {
    return findVentureForUser(user.id)
  }
  return null
}

export const findCoFounders = async ventureId => {
  if (!ventureId) {
    return []
  }
  const founderRecords = await Founder.find({
    venture: ventureId,
    status: 'ACTIVE',
  })
    .populate('user', 'username email')
    .exec()

  return founderRecords.map(r => r.user).filter(Boolean)
}

export const getTargetFounderId = (user, query = {}, body = {}) => {
  if (query.founderId) {
    return query.founderId
  }
  if (body.founderId) {
    return body.founderId
  }
  if (user?.role !== 'admin') {
    return user?.id || null
  }
  return null
}

export const findFounder = async founderId => {
  if (founderId && mongoose.isValidObjectId(founderId)) {
    return User.findById(founderId).select('-password').exec()
  }
  return null
}

export const resolveVentureAndContext = async (user, query = {}, body = {}) => {
  const ventureId = query.ventureId || body.ventureId
  const requestedFounderId = getTargetFounderId(user, query, body)
  const foundUser = await findFounder(requestedFounderId)
  const venture = await findVenture(ventureId, foundUser, user)
  const coFounders = await findCoFounders(venture ? venture._id : null)
  const founder = foundUser || (coFounders.length > 0 ? coFounders[0] : null)

  return { venture, founder, coFounders }
}

export const loadVentureSubmissions = async (ventureId, coFounders) => {
  let submissions = await BiWeeklySubmission.find({ venture: ventureId })
    .populate('biWeeklyEvaluation')
    .populate('biWeeklyObservationSchema')
    .populate('submitted_by', 'username email')
    .sort({ cycle_number: 1 })
    .exec()

  if (submissions.length === 0 && coFounders.length > 0) {
    const founderIds = coFounders.map(f => f._id)
    const legacySubmissions = await BiWeeklySubmission.find({
      founder: { $in: founderIds },
    })
      .populate('biWeeklyEvaluation')
      .populate('biWeeklyObservationSchema')
      .populate('submitted_by', 'username email')
      .sort({ cycle_number: 1 })
      .exec()

    if (legacySubmissions.length > 0) {
      await BiWeeklySubmission.updateMany(
        { _id: { $in: legacySubmissions.map(s => s._id) } },
        { $set: { venture: ventureId, scope: 'VENTURE' } }
      )
      submissions = legacySubmissions
    }
  }

  return submissions
}

export const updateOrCreateVentureSubmission = async ({
  ventureId,
  userId,
  cycle_number,
  data = {},
  isSubmit = false,
}) => {
  const custom_id = `venture_${ventureId}_cycle_${cycle_number}`
  const updateData = {
    ...data,
    cycle_number,
    venture: ventureId,
    scope: 'VENTURE',
    submitted_by: userId,
  }

  if (isSubmit) {
    updateData.submitted_at = new Date()
  }

  const submission = await BiWeeklySubmission.findOneAndUpdate(
    { custom_id },
    { $set: updateData },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )

  if (userId) {
    await User.updateOne(
      { _id: userId },
      { $addToSet: { biWeeklySubmission: submission._id } }
    )
  }

  return submission
}

export const resolveAdminTarget = async (ventureId, founderId) => {
  let venture = null
  let founder = null

  if (ventureId && mongoose.isValidObjectId(ventureId)) {
    venture = await Venture.findById(ventureId)
  }

  if (founderId && mongoose.isValidObjectId(founderId)) {
    founder = await User.findById(founderId)
    if (!venture && founder) {
      venture = await findVentureForUser(founder._id)
    }
  }

  return { venture, founder }
}
