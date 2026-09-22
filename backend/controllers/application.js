import Venture from '../models/venture.js'
import VentureJoinRequest from '../models/ventureJoinRequest.js'
import VentureProposal from '../models/ventureProposal.js'
import {
  addFounderToVenture,
  findVentureForUser,
} from '../utils/founderHelper.js'

export const getPendingApplications = async (req, res) => {
  try {
    const [proposals, joinRequests] = await Promise.all([
      VentureProposal.find({ status: 'PENDING' })
        .populate('submittedBy', 'username email')
        .populate('industry', 'name')
        .populate('campus', 'name'),
      VentureJoinRequest.find({ status: 'PENDING' })
        .populate('requestedBy', 'username email')
        .populate('venture', 'name'),
    ])

    return res.status(200).json({ proposals, joinRequests })
  } catch (error) {
    console.error('Error fetching pending applications:', error)

    return res.status(500).json({
      error: 'Could not fetch pending applications',
    })
  }
}

export const reviewProposal = async (req, res) => {
  try {
    const { proposalId } = req.params
    const { status, remarks } = req.body

    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid review status' })
    }

    const proposal = await VentureProposal.findOneAndUpdate(
      { _id: proposalId, status: 'PENDING' },
      {
        $set: { status },
        $push: {
          reviews: {
            reviewer: req.user.id,
            status,
            remarks,
          },
        },
      },
      { new: true }
    )

    if (!proposal) {
      const existing = await VentureProposal.findById(proposalId)
      if (!existing) {
        return res.status(404).json({ error: 'Proposal not found' })
      }
      return res.status(409).json({
        error: 'This proposal has already been reviewed',
      })
    }

    if (status === 'APPROVED') {
      const existingVenture = await findVentureForUser(proposal.submittedBy)

      if (existingVenture) {
        proposal.status = 'PENDING'
        proposal.reviews.pop()
        await proposal.save()

        return res.status(409).json({
          error: 'This student is already part of an active venture',
        })
      }

      try {
        const venture = await Venture.create({
          name: proposal.startupName,
          description: proposal.description,
          campus: proposal.campus,
          industry: proposal.industry,
          stage: proposal.stage,
          website: proposal.website,
        })

        // first founder is the user who submitted the proposal
        await addFounderToVenture(proposal.submittedBy, venture._id)

        proposal.venture = venture._id
        await proposal.save()
      } catch (ventureError) {
        proposal.status = 'PENDING'
        proposal.reviews.pop()
        await proposal.save()
        throw ventureError
      }
    }

    return res.status(200).json({ proposal })
  } catch (error) {
    console.error('Error reviewing proposal:', error)

    return res.status(500).json({
      error: 'Could not review proposal',
    })
  }
}

export const reviewJoinRequest = async (req, res) => {
  try {
    const { requestId } = req.params
    const { status } = req.body

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid review status' })
    }

    const joinRequest = await VentureJoinRequest.findById(requestId)
    if (!joinRequest) {
      return res.status(404).json({ error: 'Join request not found' })
    }

    if (joinRequest.status !== 'PENDING') {
      return res.status(409).json({
        error: 'This join request has already been reviewed',
      })
    }

    if (status === 'APPROVED') {
      const existingVenture = await findVentureForUser(joinRequest.requestedBy)

      if (existingVenture) {
        return res.status(409).json({
          error: 'This student is already part of a venture',
        })
      }

      const venture = await Venture.findById(joinRequest.venture)

      if (!venture) {
        return res.status(404).json({ error: 'Venture not found' })
      }

      await addFounderToVenture(joinRequest.requestedBy, venture._id)
    }

    joinRequest.status = status
    joinRequest.reviewedBy = req.user.id
    joinRequest.reviewedAt = new Date()

    await joinRequest.save()

    return res.status(200).json({ joinRequest })
  } catch (error) {
    console.error('Error reviewing join request:', error)

    return res.status(500).json({
      error: 'Could not review join request',
    })
  }
}
