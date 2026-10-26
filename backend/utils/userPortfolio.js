import User from '../models/user.js'
import VentureProposal from '../models/ventureProposal.js'
import VentureJoinRequest from '../models/ventureJoinRequest.js'
import { findVentureForUser } from './founderHelper.js'

// The user's most relevant application: a pending one if any, else the latest.
const getPendingApplication = async userId => {
  const [proposal, joinRequest] = await Promise.all([
    VentureProposal.findOne({ submittedBy: userId }).sort({ createdAt: -1 }),
    VentureJoinRequest.findOne({ requestedBy: userId })
      .sort({ createdAt: -1 })
      .populate('venture', 'name'),
  ])

  const applications = []

  if (proposal) {
    applications.push({
      type: 'PROPOSAL',
      id: proposal._id,
      status: proposal.status,
      ventureName: proposal.startupName,
      submittedAt: proposal.createdAt,
    })
  }

  if (joinRequest) {
    applications.push({
      type: 'JOIN_REQUEST',
      id: joinRequest._id,
      status: joinRequest.status,
      ventureName: joinRequest.venture?.name || null,
      submittedAt: joinRequest.createdAt,
    })
  }

  const pending = applications.filter(item => item.status === 'PENDING')
  const candidates = pending.length ? pending : applications

  return candidates.sort((a, b) => b.submittedAt - a.submittedAt)[0] || null
}

export const getUserPortfolio = async userId => {
  const [user, venture] = await Promise.all([
    User.findById(userId).populate(['role', 'batch', 'campus']),
    findVentureForUser(userId),
  ])

  if (!user) {
    return null
  }

  if (venture) {
    await venture.populate([
      {
        path: 'founders',
        populate: { path: 'user', select: 'username email' },
      },
      {
        path: 'campus',
        select: 'name',
      },
      {
        path: 'industry',
        select: 'name',
      },
    ])
  }

  const founders = venture
    ? venture.founders.map(founder => founder.user).filter(Boolean)
    : []

  const application = venture ? null : await getPendingApplication(userId)

  return {
    ...user.toJSON(),
    // Whether the KPI bot can know them in Meet by their Google account.
    googleLinked: Boolean(user.googleId),
    ventureId: venture?._id || null,
    venture: venture ? { ...venture.toJSON(), founders } : null,
    application,
  }
}
