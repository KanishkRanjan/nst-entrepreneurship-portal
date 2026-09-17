import BiWeeklyEvaluation from '../models/biWeeklyEvaluation.js'
import BiWeeklyObservation from '../models/biWeeklyObservation.js'
import BiWeeklySubmission from '../models/biWeeklySubmission.js'
import { findVentureForUser } from '../utils/founderHelper.js'
import {
  validateCycleNumber,
  resolveVentureAndContext,
  loadVentureSubmissions,
  updateOrCreateVentureSubmission,
  resolveAdminTarget,
} from '../utils/biweeklyHelper.js'

export const getBiWeeklyData = async (req, res) => {
  try {
    const { venture, founder, coFounders } = await resolveVentureAndContext(
      req.user,
      req.query
    )

    let submissions = []

    if (venture) {
      submissions = await loadVentureSubmissions(venture._id, coFounders)
    } else if (founder) {
      submissions = await BiWeeklySubmission.find({ founder: founder._id })
        .populate('biWeeklyEvaluation')
        .populate('biWeeklyObservationSchema')
        .populate('submitted_by', 'username email')
        .sort({ cycle_number: 1 })
        .exec()
    }

    const evaluations = submissions
      .map(sub => sub.biWeeklyEvaluation)
      .filter(Boolean)
    const observations = submissions
      .map(sub => sub.biWeeklyObservationSchema)
      .filter(Boolean)

    return res.json({
      founder,
      venture,
      coFounders,
      submissions,
      evaluations,
      observations,
    })
  } catch (err) {
    console.error('Get biweekly error:', err)
    return res.status(500).json({
      error: 'Failed to load bi-weekly data',
    })
  }
}

export const submitBiWeeklyCycle = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (req.user.role === 'admin') {
      return res
        .status(403)
        .json({ error: 'Admins cannot submit student bi-weekly progress' })
    }

    const { cycle_number, isSubmit, ...data } = req.body
    const cycleNum = validateCycleNumber(cycle_number)

    if (!cycleNum) {
      return res.status(400).json({ error: 'Invalid cycle number (1-13)' })
    }

    const venture = await findVentureForUser(req.user.id)
    if (!venture) {
      return res.status(400).json({
        error:
          'You must belong to an active venture to submit bi-weekly progress.',
      })
    }

    const submission = await updateOrCreateVentureSubmission({
      ventureId: venture._id,
      userId: req.user.id,
      cycle_number: cycleNum,
      data,
      isSubmit,
    })

    return res.status(200).json({
      success: true,
      message: isSubmit
        ? 'Submitted to faculty on behalf of venture'
        : 'Venture draft saved',
      submission,
    })
  } catch (err) {
    console.error('Submit biweekly cycle error:', err)
    return res.status(500).json({ error: 'Failed to save submission' })
  }
}

const getOrCreateSubmissionForAdmin = async (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: Admin access required' })
    return null
  }

  const { ventureId, founderId, cycle_number } = req.body
  const cycleNum = validateCycleNumber(cycle_number)

  if (!cycleNum) {
    res.status(400).json({ error: 'Valid cycle_number (1-13) is required' })
    return null
  }

  const { venture, founder } = await resolveAdminTarget(ventureId, founderId)

  if (!venture && !founder) {
    res.status(404).json({ error: 'Neither venture nor founder was found' })
    return null
  }

  let submission
  if (venture) {
    submission = await updateOrCreateVentureSubmission({
      ventureId: venture._id,
      userId: req.user.id,
      cycle_number: cycleNum,
    })
  } else {
    const custom_id = `${founder._id}_cycle_${cycleNum}`
    submission = await BiWeeklySubmission.findOneAndUpdate(
      { custom_id },
      {
        $set: {
          cycle_number: cycleNum,
          founder: founder._id,
          scope: 'FOUNDER',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  }

  return { venture, founder, submission, cycleNum }
}

export const saveBiWeeklyObservation = async (req, res) => {
  try {
    const target = await getOrCreateSubmissionForAdmin(req, res)
    if (!target) {
      return null
    }

    const { submission, cycleNum } = target
    const {
      observation,
      strengths,
      concerns,
      action_items,
      evidence_reviewed,
    } = req.body

    const observationData = {
      cycle_number: cycleNum,
      author_id: req.user.id,
      observation,
      strengths,
      concerns,
      action_items,
      evidence_reviewed,
    }

    let observationDoc
    if (submission.biWeeklyObservationSchema) {
      observationDoc = await BiWeeklyObservation.findByIdAndUpdate(
        submission.biWeeklyObservationSchema,
        observationData,
        { returnDocument: 'after' }
      )
    } else {
      observationDoc = await BiWeeklyObservation.create(observationData)
      submission.biWeeklyObservationSchema = observationDoc._id
      await submission.save()
    }

    return res.status(200).json({
      success: true,
      message: 'Observation saved',
      observation: observationDoc,
    })
  } catch (err) {
    console.error('Save observation error:', err)
    return res.status(500).json({ error: 'Failed to save observation' })
  }
}

export const saveBiWeeklyEvaluation = async (req, res) => {
  try {
    const target = await getOrCreateSubmissionForAdmin(req, res)
    if (!target) {
      return null
    }

    const { submission, cycleNum } = target
    const { execution_score, customer_score, business_score, behavior_score } =
      req.body

    const evaluationData = {
      checklist_id: cycleNum,
      month_number: Math.ceil(cycleNum / 2),
      year: new Date().getFullYear(),
      execution_score,
      customer_score,
      business_score,
      behavior_score,
    }

    let evaluationDoc
    if (submission.biWeeklyEvaluation) {
      evaluationDoc = await BiWeeklyEvaluation.findByIdAndUpdate(
        submission.biWeeklyEvaluation,
        evaluationData,
        { returnDocument: 'after' }
      )
    } else {
      evaluationDoc = await BiWeeklyEvaluation.create(evaluationData)
      submission.biWeeklyEvaluation = evaluationDoc._id
      await submission.save()
    }

    return res.status(200).json({
      success: true,
      message: 'Evaluation saved',
      evaluation: evaluationDoc,
    })
  } catch (err) {
    console.error('Save evaluation error:', err)
    return res.status(500).json({ error: 'Failed to save evaluation' })
  }
}

export const reopenBiWeeklySubmission = async (req, res) => {
  try {
    const target = await getOrCreateSubmissionForAdmin(req, res)
    if (!target) {
      return null
    }

    const { submission } = target
    submission.submitted_at = null
    await submission.save()

    return res.status(200).json({
      success: true,
      message: 'Cycle unlocked for venture team',
      submission,
    })
  } catch (err) {
    console.error('Reopen submission error:', err)
    return res.status(500).json({ error: 'Failed to reopen submission' })
  }
}
