import mongoose from 'mongoose'
import startupStage from './enums/startupStage.js'

const ventureSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    campus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campus',
      required: true,
    },
    description: {
      type: String,
    },
    stage: {
      type: String,
      enum: Object.keys(startupStage),
      default: 'IDEATION',
    },
    industry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Industry',
      required: true,
    },
    website: {
      type: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

ventureSchema.virtual('founders', {
  ref: 'Founder',
  localField: '_id',
  foreignField: 'venture',
  match: { status: 'ACTIVE' },
})

ventureSchema.virtual('teamSize', {
  ref: 'Founder',
  localField: '_id',
  foreignField: 'venture',
  match: { status: 'ACTIVE' },
  count: true,
})

ventureSchema.virtual('biWeeklySubmissions', {
  ref: 'BiWeeklySubmission',
  localField: '_id',
  foreignField: 'venture',
})

export const modelName = 'Venture'

const Venture = mongoose.model(modelName, ventureSchema)

export default Venture
